import {
    command,
    run,
    string,
    option,
    optional,
    boolean,
    number,
    flag,
} from "cmd-ts";

import { z } from "zod";
import { $ } from "zx";
import { zodToJsonSchema } from "zod-to-json-schema";

import ollama from "ollama";

import * as readline from "readline";

/**
 * Prompts the user for input and returns the entered string
 * @param message The message to display to the user
 * @returns The user's input as a string
 */
async function ask(message: string): Promise<string> {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    return new Promise<string>((resolve) => {
        rl.question(message, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

async function parseArgs(): Promise<{
    interactive: boolean;
    model: string;
    wip: boolean;
}> {
    return await new Promise((resolve) => {
        const app = command({
            name: "git-aicommit",
            args: {
                interactive: flag({
                    type: boolean,
                    description: "Interactively stage changes",
                    long: "interactive",
                    short: "p",
                    defaultValue: () => false,
                }),
                wip: flag({
                    type: boolean,
                    description: "Mark the commit as a work in progress",
                    long: "wip",
                    short: "w",
                    defaultValue: () => false,
                }),
                model: option({
                    description: "Model to use",
                    long: "model",
                    short: "m",
                    defaultValue: () => "mistral:latest",
                }),
            },
            handler: (args) => {
                resolve(args);
            },
        });

        run(app, process.argv.slice(2));
    });
}

const args = await parseArgs();

const CommitMessage = z.object({
    commitTitle: z.string(),
    commitDescription: z.string(),
});

async function main(): Promise<number> {
    const gitRoot = (await $`git rev-parse --show-toplevel`).stdout.trim();
    $.cwd = gitRoot;

    const changedFiles = (await $`git status --porcelain`).stdout.trim();

    if (!changedFiles) {
        console.log("No changes to commit");
        return 1;
    }

    // Add untracked files to the staging area
    await $`git ls-files --others --exclude-standard . | xargs git add --intent-to-add`;

    if (args.interactive) {
        await $({ stdio: "inherit" })`git add . -p`;
    } else {
        await $`git add .`;
    }

    const diff = (await $`git diff --cached`).stdout.trim();

    console.log("");
    console.log(diff);
    console.log("");

    let refine = "";
    const prompt = `
        Write a git commit message with a title and description based on the following changes.
        If there are multiple seemingly unrelated changes, just write "multiple changes"
        ${refine}

        The git diff:

        ${diff}
    `;

    while (true) {
        console.log("Running Ollama...");
        const response = await ollama.chat({
            model: args.model,
            messages: [{ role: "user", content: prompt }],
            format: zodToJsonSchema(CommitMessage),
        });

        let commitMessage;
        try {
            commitMessage = CommitMessage.parse(
                JSON.parse(response.message.content),
            );
        } catch (error) {
            console.error(
                "Failed to parse commit message:",
                error,
                response.message.content,
            );
            return 1;
        }

        console.log("Commit message:");
        console.log(commitMessage.commitTitle);
        console.log("");
        console.log(commitMessage.commitDescription);
        console.log("");

        // Confirm commit message with user
        const answer = await ask("Proceed with commit? (y/n/r/e/?): ");

        switch (answer) {
            case "?":
                console.log("y - Proceed with commit");
                console.log("a - Proceed with commit and amend");
                console.log("n - Abort commit");
                console.log("r - Retry commit");
                console.log("e - Edit prompt message");
                continue;
            case "r":
                continue;
            case "e":
                refine = await ask("Add to prompt> ");
                continue;
            case "a":
            case "y":
                break;
            default:
                console.log("Commit aborted.");
                return 1;
        }

        // Add WIP prefix if requested
        if (args.wip) {
            commitMessage.commitTitle = `WIP: ${commitMessage.commitTitle}`;
        }

        const message = `${commitMessage.commitTitle}\n\n${commitMessage.commitDescription}`;

        const commit = $`git commit -F -`;
        commit.stdin.write(message);
        commit.stdin.end();
        await commit;

        if (answer === "a") {
            await $({ stdio: "inherit" })`git commit --amend`;
        }

        return 0;
    }
}

let code = 0;
try {
    code = await main();
} finally {
    await $`git reset HEAD`;
}

process.exit(code);

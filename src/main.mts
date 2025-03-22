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
    wip: boolean;
}> {
    return await new Promise((resolve) => {
        const app = command({
            name: "git-ai",
            args: {
                wip: flag({
                    type: boolean,
                    description: "Mark the commit as a work in progress",
                    long: "wip",
                    short: "w",
                    defaultValue: () => false,
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
        return;
    }

    await $`git add .`;

    const diff = (await $`git diff --cached`).stdout.trim();

    const prompt = `
        Write a git commit message with a title and description based on the following changes:

        ${diff}
    `;

    const response = await ollama.chat({
        model: "mistral:latest",
        messages: [{ role: "user", content: prompt }],
        format: zodToJsonSchema(CommitMessage),
    });

    let commitMessage;
    try {
        commitMessage = CommitMessage.parse(
            JSON.parse(response.message.content),
        );
    } catch (error) {
        await $`git reset HEAD`;
        console.error(
            "Failed to parse commit message:",
            error,
            response.message.content,
        );
        return 1;
    }

    console.log("Commit message:");
    console.log("");
    console.log("");
    console.log(commitMessage.commitTitle);
    console.log("");
    console.log(commitMessage.commitDescription);
    console.log("");
    console.log("");

    // Confirm commit message with user
    const answer = await ask("Proceed with commit? (y/N): ");

    console.log("answer:", answer);
    if (answer !== "y") {
        await $`git reset HEAD`;
        console.log("Commit aborted.");
        return 1;
    }

    // Add WIP prefix if requested
    if (args.wip) {
        commitMessage.commitTitle = `WIP: ${commitMessage.commitTitle}`;
    }

    await $`git commit -m ${commitMessage.commitTitle}\n\n${commitMessage.commitDescription}`;
}

process.exit(await main());

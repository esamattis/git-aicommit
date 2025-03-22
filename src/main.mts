#!/usr/bin/env node
import {
    command,
    run,
    string,
    option,
    optional,
    restPositionals,
    boolean,
    number,
    flag,
    positional,
} from "cmd-ts";

import path from "path";
import fs from "fs/promises";
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
    lazygit: boolean;
    path: string[];
}> {
    return await new Promise((resolve) => {
        const app = command({
            name: "git-aicommit",
            args: {
                path: restPositionals({
                    type: string,
                    displayName: "path",
                    description: "Path to the directory to commit",
                }),
                interactive: flag({
                    type: boolean,
                    description: "Interactively stage changes",
                    long: "interactive",
                    short: "p",
                    defaultValue: () => false,
                }),
                lazygit: flag({
                    type: boolean,
                    description:
                        "Write commit message to .git/LAZYGIT_PENDING_COMMIT",
                    long: "lazygit",
                    short: "l",
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

    let cwd = ".";
    if (args.path[0]) {
        cwd = args.path[0];
    } else {
        cwd = gitRoot;
    }

    $.cwd = cwd;

    const changedFiles = (await $`git status --porcelain`).stdout.trim();

    if (!changedFiles) {
        console.log("No changes to commit");
        return 1;
    }

    if (!args.lazygit) {
        // Add untracked files to the staging area
        await $`git ls-files --others --exclude-standard . | xargs git add --intent-to-add`;

        if (args.interactive) {
            await $({ stdio: "inherit" })`git add . -p`;
        } else {
            await $`git add .`;
        }
    }

    const diff = (await $`git diff -U10 --cached`).stdout.trim();

    console.log("");
    console.log(diff);
    console.log("");

    let refine = "";
    const prompt = `
        Write a git commit message with a title and description based on the
        following changes. If there are multiple seemingly unrelated changes,
        just write "multiple changes". Do not mention "refactoring".
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
            console.error("Failed to parse commit message:", error, response);
            return 1;
        }

        console.log("Commit message:", commitMessage.commitTitle);
        console.log("");
        console.log(commitMessage.commitDescription);
        console.log("");

        const answer = await ask("Proceed with commit? (y/a/n/r/e/?): ");

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

        if (args.wip) {
            commitMessage.commitTitle = `WIP: ${commitMessage.commitTitle}`;
        }

        let message = `${commitMessage.commitTitle}\n\n${commitMessage.commitDescription}\n\nCommit message by ${args.model}`;

        if (args.wip) {
            message += `\n[skip ci]`;
        }

        if (args.lazygit) {
            await fs.writeFile(
                path.join(gitRoot, ".git", "LAZYGIT_PENDING_COMMIT"),
                message,
            );
        } else {
            const commit = $`git commit -F -`;
            commit.stdin.write(message);
            commit.stdin.end();
            await commit;

            if (answer === "a") {
                await $({ stdio: "inherit" })`git commit --amend`;
            }
        }

        return 0;
    }
}

let code = 0;
try {
    code = await main();
} finally {
    if (!args.lazygit) {
        await $`git reset HEAD`;
    }
}

process.exit(code);

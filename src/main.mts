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
import { expand, select, input, Separator } from "@inquirer/prompts";

import path from "path";
import fs from "fs/promises";
import { toJsonSchema } from "@valibot/to-json-schema";
import * as v from "valibot";
import { $ } from "zx";
import ollama from "ollama";
import * as readline from "readline";

async function parseArgs(): Promise<{
    interactive: boolean;
    model: string | undefined;
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
                    type: optional(string),
                    description: "Model to use",
                    long: "model",
                    short: "m",
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

const CommitMessage = v.object({
    commitTitle: v.string(),
    commitDescription: v.string(),
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

        If the description does not add any new information leave the description blank.

        ${refine}

        The git diff:

        ${diff}
    `;

    let model = args.model;

    if (!model) {
        const models = await ollama.list();

        model = await select({
            message: "Select a model",
            default: args.model,
            choices: models.models.map((model) => ({
                name: model.name,
                value: model.name,
            })),
        });
    }

    while (true) {
        console.log("Running Ollama...");
        const response = await ollama.chat({
            model,
            messages: [{ role: "user", content: prompt }],
            format: toJsonSchema(CommitMessage),
        });

        let commitMessage;
        try {
            commitMessage = v.parse(
                CommitMessage,
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

        const answer = await expand({
            message: "Proceed with commit?",
            default: "y",
            expanded: true,
            choices: [
                { name: "Yes - Proceed with commit", key: "y", value: "y" },
                {
                    name: "Amend - Proceed with commit and amend",
                    key: "a",
                    value: "a",
                },
                { name: "No - Abort commit", key: "n", value: "n" },
                { name: "Retry - Retry commit", key: "r", value: "r" },
                { name: "Edit - Edit prompt message", key: "e", value: "e" },
                { name: "Show the prompt", key: "s", value: "s" },
            ],
        });

        switch (answer) {
            case "r":
                continue;
            case "e":
                refine = await input({ message: "Add to prompt> " });
                continue;
            case "s":
                console.log(prompt);
                await expand({
                    message: "Continue",
                    default: "y",
                    choices: [{ name: "Yes", key: "y", value: "y" }],
                });
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

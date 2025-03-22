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

interface Args {
    interactive: boolean;
    model: string | undefined;
    wip: boolean;
    lazygit: boolean;
    path: string[];
}

async function parseArgs(): Promise<Args> {
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

const CommitMessage = v.object({
    commitTitle: v.string(),
    commitDescription: v.string(),
});

class CommitBuilder {
    prompt = "";
    model = "";
    message = "";
    args: Args;

    constructor(args: Args) {
        this.args = args;
    }

    async selectModel() {
        const models = await ollama.list();
        this.model = this.args.model ?? "";
        this.model = await select({
            message: "Select a model",
            default: this.args.model,
            choices: models.models.map((model) => ({
                name: model.name,
                value: model.name,
            })),
        });
    }

    async generateCommitMessage() {
        console.log("Running Ollama...");
        const response = await ollama.chat({
            model: this.model,
            messages: [{ role: "user", content: this.prompt }],
            format: toJsonSchema(CommitMessage),
        });

        let commitMessage;
        try {
            commitMessage = v.parse(
                CommitMessage,
                JSON.parse(response.message.content),
            );
        } catch (error) {
            console.error("Failed to parse commit message:", response);
            throw error;
        }

        if (this.args.wip) {
            commitMessage.commitTitle = `WIP: ${commitMessage.commitTitle}`;
        }

        let message = `${commitMessage.commitTitle}\n\n${commitMessage.commitDescription}\n\nCommit message by ${this.model}`;

        if (this.args.wip) {
            message += `\n[skip ci]`;
        }

        this.message = message;
    }

    async setPrompt() {
        const diff = (await $`git diff -U10 --cached`).stdout.trim();

        this.prompt = `
            Write a git commit message with a title and description based on the
            following changes. If there are multiple seemingly unrelated changes,
            just write "multiple changes". Do not mention "refactoring".

            If the description does not add any new information leave the description blank.

            The git diff:

            ${diff}
        `;
    }

    async run() {
        const gitRoot = (await $`git rev-parse --show-toplevel`).stdout.trim();

        let cwd = ".";
        if (this.args.path[0]) {
            cwd = this.args.path[0];
        } else {
            cwd = gitRoot;
        }

        $.cwd = cwd;

        const changedFiles = (await $`git status --porcelain`).stdout.trim();

        if (!changedFiles) {
            console.log("No changes to commit");
            return 1;
        }

        if (!this.args.lazygit) {
            // Add untracked files to the staging area
            await $`git ls-files --others --exclude-standard . | xargs git add --intent-to-add`;

            if (this.args.interactive) {
                await $({ stdio: "inherit" })`git add . -p`;
            } else {
                await $`git add .`;
            }
        }

        await this.setPrompt();

        if (!this.model) {
            await this.selectModel();
        }

        await this.generateCommitMessage();

        while (true) {
            console.log("Commit message:\n", this.message);

            const answer = await expand({
                message: "Proceed with commit?",
                default: "y",
                expanded: true,
                choices: [
                    { name: "Yes - Proceed with commit", key: "y", value: "y" },
                    { name: "Change model", key: "m", value: "m" },
                    {
                        name: "Amend - Proceed with commit and amend",
                        key: "a",
                        value: "a",
                    },
                    { name: "No - Abort commit", key: "n", value: "n" },
                    { name: "Retry - Retry commit", key: "r", value: "r" },
                    { name: "Show the prompt", key: "s", value: "s" },
                ],
            });

            switch (answer) {
                case "r":
                    await this.generateCommitMessage();
                    continue;
                case "m":
                    await this.selectModel();
                    await this.generateCommitMessage();
                    continue;
                case "s":
                    console.log(this.prompt);
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

            if (this.args.lazygit) {
                await fs.writeFile(
                    path.join(gitRoot, ".git", "LAZYGIT_PENDING_COMMIT"),
                    this.message,
                );
            } else {
                const commit = $`git commit -F -`;
                commit.stdin.write(this.message);
                commit.stdin.end();
                await commit;

                if (answer === "a") {
                    await $({ stdio: "inherit" })`git commit --amend`;
                }
            }

            return 0;
        }
    }
}

const args = await parseArgs();
const builder = new CommitBuilder(args);

let code = 0;
try {
    code = await builder.run();
} finally {
    if (!args.lazygit) {
        await $`git reset HEAD`;
    }
}

process.exit(code);

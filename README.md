# git-aicommit

A command-line tool that uses Ollama to automatically generate good Git commit messages based on your changes.

## Features

- Generates meaningful commit titles and descriptions from your git diffs
- Uses Ollama with the model of your choice (defaults to mistral:latest)
- Interactive mode to selectively stage changes
- Option to mark commits as work in progress
- Ability to refine or edit the AI prompt for better results
- Support for amending commits


## Usage

```
git-aicommit

ARGUMENTS:
  [...path] - Path to the directory to commit

FLAGS:
  --interactive, -p - Interactively stage changes
  --wip, -w         - Mark the commit as a work in progress
  --help, -h        - show help

OPTIONS:
  --model, -m <str> - Model to use [optional]
```

## Example

```
❯ git-aicommit

diff --git a/src/main.mts b/src/main.mts
index 9bf7347..29e801f 100644
--- a/src/main.mts
+++ b/src/main.mts
@@ -48,7 +48,11 @@ async function parseArgs(): Promise<{
         const app = command({
             name: "git-aicommit",
             args: {
-                path: restPositionals({ type: string, displayName: "path" }),
+                path: restPositionals({
+                    type: string,
+                    displayName: "path",
+                    description: "Path to the directory to commit",
+                }),
                 interactive: flag({
                     type: boolean,
                     description: "Interactively stage changes",

Running Ollama...
Commit message:
Add description to 'path' positional argument and update its documentation

Adjusted the 'git-aicommit' command by providing a description for the 'path' positional argument in the main function. The updated description now explains that this option is used to specify the directory path for committing.

Proceed with commit? (y/n/r/e/?): y
```

## Requirements

- Node.js
- Git
- Ollama

## Installation

On the git checkout

```
npm install -g .
```

## Lazygit integration

Add this to `config.yml` and hit `<c-a>` after staging changes

```
customCommands:
    - key: <c-a>
      description: AI commit
      command: git-aicommit --lazygit
      context: files
      subprocess: true
      showOutput: true
```


## License

MIT

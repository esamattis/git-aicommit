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

FLAGS:
  --interactive, -p - Interactively stage changes
  --wip, -w         - Mark the commit as a work in progress
  --help, -h        - show help

OPTIONS:
  --model, -m <str> - Model to use [optional]
```


## Requirements

- Node.js
- Git
- Ollama

## License

MIT


# Toggl Track – Hour Slip Calculator

Calculate the current hour slip (tuntiliukuma, liukuma-aika, tuntikertymä) for a
Toggl Track workspace. Handles finnish holidays (arkipyhät) and weekends.
Configure following environment variables:

```
TOGGL_USERNAME=""
TOGGL_PASSWORD=""
TOGGL_WORKSPACE_ID=""
```

The `TOGGL_WORKSPACE_ID` is the id of the workspace you want to calculate the hour
slip for. You can find it in the URL of the workspace in Toggl Track.

Use Node.js 23. See [mise.toml](mise.toml)

Usage:

```
❯ npm ci
❯ node src/main.mts --help
toggl-slip

OPTIONS:
  --target, -t <number>  - Hour target in decimal format. Defaults to 7.5 [optional]
  --last, -l <number>    - Show only the last N days, but still fetch from the --start-date [optional]
  --exclude, -x <str>    - Exclude time entries from calculcations whose descriptions contain the given string [optional]
  --filter, -F <str>     - Filter the table to only include time entries whose descriptions contain the given string. Does not affect calculations [optional]
  --start-date, -s <str> - Start day of the slip calculation. Defaults to the start of the current week [optional]
  --end-date, -e <str>   - End day of the slip calculation. Defaults to the current day [optional]

FLAGS:
  --links, -L    - Show Toggl links for each day
  --projects, -p - Include project names in the descriptions
  --all, -a      - Show even the empty days
  --fresh, -f    - Clear cached requests. Use when you have made changes to your Toggl account during the day. When just playing with the flags you can use the cache. The cache is automatically cleared after 12h
  --help, -h     - show help
```

<img width="724" alt="image" src="https://github.com/user-attachments/assets/035fc998-3fa6-4273-8e31-795cf453c1b9" />

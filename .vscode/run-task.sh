#!/bin/sh
# Runs a task's command for tasks.json. The tasks close their terminal when they exit, which takes the panel back to
# the terminal that was open before. On failure, this waits for Enter first, so the output stays until it's read.
sh -c "$1" && exit 0
status=$?
printf '\nFailed with exit code %s. Press Enter to close.\n' "$status"
read -r _
exit "$status"

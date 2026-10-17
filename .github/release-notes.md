# v@VERSION@

## Installing

Download `com.daczarne.litra.streamDeckPlugin` below and open it: Stream Deck installs the plugin, and its actions appear under the **Litra** category. It needs Stream Deck 7.1 or later, on macOS 12 or later or Windows 10 or later. A newer release installs the same way, over the one installed, and the README's Installing section says how to remove it.

## Before installing

- The plugin is developed and checked on macOS, with Litra Beams, run from its repository rather than installed from a release.
- It should work on Windows, and with the Beam LX and Glow front lights, but it isn't checked there. The Beam LX back light isn't supported.
- If something doesn't work, an issue with the plugin's log helps: the README says where the logs are. They hold your lamps' serial numbers, so replace those before posting.

## Verifying the download

The file's SHA-256 is `@SHA256@`. To compare it with your download's:

- On macOS: `shasum -a 256 com.daczarne.litra.streamDeckPlugin`
- On Windows, in PowerShell: `Get-FileHash com.daczarne.litra.streamDeckPlugin`

The file was built by this repository's workflow, from the commit this release points to, which an attestation records. With the [GitHub CLI][gh], check it with:

```shell
gh attestation verify com.daczarne.litra.streamDeckPlugin --repo daczarne/streamdeck-litra
```

[gh]: https://cli.github.com

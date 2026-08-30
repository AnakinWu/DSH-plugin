# dsh-archive-finder

Find and restore archived DSH sessions, and auto-archive idle ones after 3 days.

- Restore panel: bring archived sessions back to the sidebar with one click.
- Auto-archive: sessions idle for 3+ days are archived automatically (configurable via `DSH_ARCHIVE_FINDER_AGE_DAYS`).

## Install

Install via the [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) list, or from this monorepo subdirectory (`packages/dsh-archive-finder`).

## Screenshots

Screenshots are declared in `screenshots.json` (to be added).

## Configuration (environment variables)

| Variable | Default | Meaning |
|---|---|---|
| `DSH_ARCHIVE_FINDER_AGE_DAYS` | `3` | Idle days before a session is auto-archived. |
| `DSH_ARCHIVE_FINDER_AUTO` | `on` | Set `off` to disable auto-archive sweeps. |
| `DSH_ARCHIVE_FINDER_INTERVAL_HOURS` | - | Hours between auto-archive sweeps. |
| `DSH_ARCHIVE_FINDER_FIRST_DELAY_S` | - | Delay in seconds before the first sweep. |

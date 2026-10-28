# USB-RS485 Tool

A TypeScript and Electron desktop shell for viewing machine configuration CSV files. Serial sending is not implemented yet.

## Configuration files

The app loads one of these external files:

- `Addresses.csv` — address definitions and command metadata
- `operator.csv` — operator names and employee IDs

In development, files are read from the project directory. In the packaged portable app, files are read beside `UsbR485Tool.exe` (the portable app also supports Electron's portable-data directory). The files can be replaced and reselected without rebuilding.

Use the two buttons in the application to load and edit the selected file. Change values directly in the table and choose **Save changes** to write the edited file beside the executable. The CSV parser handles quoted fields, escaped double quotes, embedded line breaks, CRLF, BOMs, and varied field widths. The application menu bar is hidden.

## Development

Node.js and npm are required. Dependencies are not included in the repository:

```powershell
npm install
npm start
```

Validate strict TypeScript without producing output:

```powershell
npm run typecheck
```

Create a Windows x64 portable executable:

```powershell
npm run package
```

The artifact is written to `dist/electron/UsbR485Tool-x64-portable.exe`. Before distributing it, keep `Addresses.csv` and `operator.csv` beside the executable.

## GitHub Actions builds

Open **Actions → Build Windows portable app → Run workflow** to create a manual portable build. The downloadable `UsbR485Tool-win-x64` artifact is a zip containing the executable and both CSV files at the root.

Open **Actions → Build Windows installer → Run workflow** to create a manual installable Windows x64 build. Builds are not triggered automatically, so README-only changes do not run workflows.

## Startup timing log

Each launch appends timing events to `startup.log` in Electron's application user-data folder (under `%APPDATA%` on Windows). Events include a `runId` so you can compare launches; the file is capped at about 1 MiB and older entries are cleared when it grows beyond that. It records process start, Electron readiness, window/page/renderer readiness, and CSV load/parse/render timings. The `startup-log-initialized` event includes the exact log path. It does not record CSV contents. The process-start event is the first point inside the Electron app; portable executable extraction happens before that point and must be measured externally.

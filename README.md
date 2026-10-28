# USB-RS485 Tool

A TypeScript and Electron desktop application for viewing machine configuration CSV files and scanning USB-RS485 addresses.

## Configuration files

The app loads one of these external files:

- `Addresses.csv` — address definitions and command metadata
- `operator.csv` — operator names and employee IDs
- `config.json` — transport mode, scan address range, and simulated device firmware

In development, files are read from the project directory. In the packaged portable app, files are read beside `UsbR485Tool.exe` (the portable app also supports Electron's portable-data directory). The files can be replaced and reselected without rebuilding.

Use the two buttons in the application to load and edit the selected file. Change values directly in the table and choose **Save changes** to write the edited file beside the executable. The CSV parser handles quoted fields, escaped double quotes, embedded line breaks, CRLF, BOMs, and varied field widths. The application menu bar is hidden.

## Address scanning

Choose **Scan addresses** to query the configured range with command `137`. The scanner loads `Addresses.csv`, compares the returned major/minor firmware bytes with its `fwVersion` or `FirmwareVersion` column, and displays connection and match status. Firmware values use the CSV form `major.minor`, with the minor part padded to two digits (for example, bytes `5, 1` display as `5.01`).

The checked-in `config.json` selects simulation mode by default. Edit its `simulation.devices` list to control simulated responses; addresses not listed simulate a timeout. Set `transport` to `ftdi` only after supplying a native D2XX adapter in the Electron main process. `FtdiTransport` implements the legacy 8-byte packet, checksum, and response parsing through its `D2xxDevice` interface. This project does not include or select a specific native D2XX Node binding.

The scan range is external configuration (`addressRange.start` and `addressRange.end`); its default is `0` through `86`.

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

The artifact is written to `dist/electron/UsbR485Tool-x64-portable.exe`. Keep `Addresses.csv`, `operator.csv`, and `config.json` beside the executable.

## GitHub Actions builds

The portable build runs automatically when changes are pushed to `main` (Markdown-only changes are ignored). You can also run **Actions → Build Windows portable app → Run workflow** manually. The `UsbR485Tool-win-x64` Actions artifact contains the executable and the external configuration files at its root; GitHub packages the artifact for download.

The installable Windows x64 build remains manual: choose **Actions → Build Windows installer → Run workflow**. It does not autobuild on pushes. Its Actions artifact contains the setup executable and the external configuration files at its root.

## Startup timing log

Each launch appends timing events to `startup.log` in Electron's application user-data folder (under `%APPDATA%` on Windows). Events include a `runId` so you can compare launches; the file is capped at about 1 MiB and older entries are cleared when it grows beyond that. It records process start, Electron readiness, window/page/renderer readiness, and CSV load/parse/render timings. The `startup-log-initialized` event includes the exact log path. It does not record CSV contents. The process-start event is the first point inside the Electron app; portable executable extraction happens before that point and must be measured externally.

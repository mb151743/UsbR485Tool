# USB-RS485 Tool

A TypeScript and Electron desktop application for the inVia pre-system test workflow, including operator/serial entry and USB-RS485 address scanning.

## Configuration files

The app loads one of these external files:

- `Addresses.csv` — address definitions and command metadata
- `operator.csv` — operator names and employee IDs
- `config.json` — transport mode, scan address range, simulated device firmware, and the last selected operator

In development, files are read from the project directory. In the packaged portable app, files are read beside `UsbR485Tool.exe` (the portable app also supports Electron's portable-data directory). The files can be replaced and reselected without rebuilding.

Use **Addresses.csv** and **operator.csv** to view and edit the selected file. Change values directly in the table and choose **Save changes** to write the edited file beside the executable. The CSV parser handles quoted fields, escaped double quotes, embedded line breaks, CRLF, BOMs, and varied field widths. The application menu bar is hidden.

## Address scanning

Enter a six-character serial number, choose an operator from `operator.csv`, and choose **Scan hardware**. The serial number is checked for length only. The selected operator is saved as `lastOperator` in `config.json` and preselected next time the application starts.

The scan queries the configured range with command `137`, loads expected firmware from the `fwVersion` or `FirmwareVersion` column in `Addresses.csv`, and displays only devices that reply with the matching address and command. A warning icon and inline text mark firmware mismatches; no popup is shown. Scanning does not run motor tests or send motor movement commands. Firmware values use the CSV form `major.minor`, with the minor part padded to two digits (for example, bytes `5, 1` display as `5.01`).

The checked-in `config.json` selects simulation mode by default. Edit its `simulation.devices` list to control simulated responses; addresses not listed simulate a timeout. Set `transport` to `ftdi` only after supplying a native D2XX adapter in the Electron main process. `FtdiTransport` implements the legacy 8-byte packet, checksum, and response parsing through its `D2xxDevice` interface. This project does not include or select a specific native D2XX Node binding.

The scan range is external configuration (`addressRange.start` and `addressRange.end`); its default is `0` through `86`. `config.json` also contains `lastOperator`, which the app updates when the operator selection changes.

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

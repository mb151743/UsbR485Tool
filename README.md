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

The scan queries the configured range with command `137`, loads expected firmware from the `fwVersion` or `FirmwareVersion` column in `Addresses.csv`, and displays only devices that reply with the matching address and command. A warning icon and inline text mark firmware mismatches; no popup is shown. Connected devices configured with `Test name` set to `motor` are also offered the configured reference and position checks. Other legacy workflows, including the slit motor and interlock-board tests, are not yet ported; those devices do not currently appear in the motor-test list. Failed motors can be rerun or marked ignored. A plain-text report is saved under `TestData` and records each motor's result and attempts, plus an overall pass/fail. The overall result is `PASS` only when at least one motor passed and every remaining motor passed or was explicitly ignored; unresolved or untested motors result in `FAIL`. Firmware values use the CSV form `major.minor`, with the minor part padded to two digits (for example, bytes `5, 1` display as `5.01`).

The bottom status bar checks Windows Plug and Play device friendly names and separately loads the FTDI D2XX library to enumerate D2XX device descriptions. D2XX enumeration does not open a controller or verify RS-485 communication.

Motor tests use the legacy reference command (`132`), status command (`128`), position command encoding, and abort command (`131`). Like the legacy app, the new app does not require the controller to echo the reference or position command number; it verifies the address and then polls status for completion. In simulation mode, reports explicitly state that physical motor movement was not verified. In FTDI mode, motor commands are sent to the connected controller; validate this only on a supervised bench with the motor's travel area clear. The limit-switch workflow uses command `130` and status bits 3 and 4; hold **Down Arrow** to jog and release it to send abort command `131`. The optional **Auto-jog limit switches** checkbox is unchecked by default; when enabled, the configured jog repeats without requiring the key until the switch registers or the 120-second operation timeout expires. Simulation cannot verify a physical switch and therefore marks configured switch checks failed without sending jog commands. Other non-motor test routines are not yet ported.

The app appends UI action and transport command events as one JSON object per line to `TestData/activity.log`, beside the executable (or in the project directory in development). Entries include timestamps, command address/number/data, and response/error details. Typed serial numbers, operator names, and CSV contents are not logged.

The checked-in `config.json` selects simulation mode by default. Edit its `simulation.devices` list to control simulated responses; addresses not listed simulate a timeout. The default simulation includes the motor addresses in `Addresses.csv` that are configured for tests. To use hardware, set `transport` to `ftdi` and install the 64-bit Windows FTDI D2XX driver. The application looks for `FTD2XX64.dll` or `ftd2xx.dll` in `%SystemRoot%\System32` or beside the executable; set the `FTD2XX_DLL_PATH` environment variable to use another DLL location. The DLL must match the app's x64 architecture. The legacy `ftd2xx.dll` in the old VB6 source is 32-bit and is not compatible. The app enumerates D2XX descriptions and tries `RA802`, `SEMSCA`, then `MSC20`, applying the legacy 500 ms read/write timeouts and 2 ms latency setting. `FtdiTransport` implements the legacy 8-byte packet, checksum, and response parsing. Each scan or motor run opens the D2XX device and closes it afterward.

The FTDI driver package is installed in Windows using its setup/INF files; its `.sys` driver files, language/UI DLLs, and `.lib` development import library do not need to be copied beside the application. The D2XX runtime DLL (`FTD2XX64.dll`) may be installed under Windows or placed beside the executable, or pointed to with `FTD2XX_DLL_PATH`. Keep the supplied driver package intact and use its vendor installer rather than manually copying `.sys` files.

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

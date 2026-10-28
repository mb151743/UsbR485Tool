# USB-RS485 Tool

A TypeScript and Electron desktop shell for viewing machine configuration CSV files. Serial sending is not implemented yet.

## Configuration files

The app loads one of these external files:

- `Addresses.csv` — address definitions and command metadata
- `operator.csv` — operator names and employee IDs

In development, files are read from the project directory. In the packaged portable app, files are read beside `UsbR485Tool.exe` (the portable app also supports Electron's portable-data directory). The files can be replaced and reselected without rebuilding.

Use the two buttons in the application to load and display the selected file. The CSV parser handles quoted fields, escaped double quotes, embedded line breaks, CRLF, BOMs, and varied field widths.

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

## Automated build

GitHub Actions builds the portable Windows x64 executable and uploads it as `UsbR485Tool-win-x64`. Workflow runs ignore Markdown-only pushes and pull requests.

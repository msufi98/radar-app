# NEXRAD Radar Viewer

A web-based NEXRAD Level 2 radar data viewer that displays real-time and historical weather radar data from the NOAA NEXRAD network.

## Features

- **Interactive Map**: Google Maps integration with radar site markers across the US
- **Historical Data Access**: Browse radar data from 1991 to present via AWS S3
- **Multiple Scan Levels**: View different elevation angles and resolutions
- **Zoom & Pan**: Detailed inspection of radar data with zoom controls
- **Cross-Section Views**:
  - Vertical cross-section showing height vs range along an azimuth
  - Arc cross-section showing height vs azimuth at a specific range
- **Real-time Rendering**: Cell-based radar visualization with reflectivity color scale

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES6 modules)
- **Build Tool**: Webpack 5
- **Maps**: Google Maps JavaScript API
- **Data Source**: AWS S3 (NOAA NEXRAD Level 2 Archive)
- **Compression**: pako (for bzip2 decompression of radar files)
- **Styling**: CSS3 with custom properties

## Prerequisites

- Node.js (v16 or higher)
- npm (v8 or higher)
- Google Maps API key

## Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd nexrad-converter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure your Google Maps API key in `src/index.html`

## Development

Start the development server with hot reload:

```bash
npm run dev
```

Or with auto-open browser:

```bash
npm start
```

The development server runs at `http://localhost:3001`

## Build

Create a production build:

```bash
npm run build
```

This generates optimized files in the `dist/` directory.

## Usage

1. **Select a Date**: Use the year, month, and day dropdowns to choose a date
2. **Choose a Radar Site**: Click on a radar marker on the map (yellow = available data, gray = no data for selected date)
3. **Select Time**: Choose from available radar scans for that day
4. **View Data**: Select resolution and elevation angle to display radar reflectivity
5. **Explore**:
   - Click and drag on the radar display to view detailed zoom and cross-section data
   - Use the zoom controls (+/-) to adjust detail level
   - Cross-section panels show vertical structure of storms

## Deployment

1. Build the project:
   ```bash
   npm run build
   ```

2. Deploy the contents of `dist/` to any static file server

3. Ensure your server serves `index.html` for all routes

## Project Structure

```
nexrad-converter/
├── src/
│   ├── modules/           # Feature modules
│   │   ├── cross-section.js
│   │   ├── data-loader.js
│   │   ├── map-manager.js
│   │   ├── radar-display.js
│   │   ├── ui-controller.js
│   │   └── zoom-feature.js
│   ├── app.js             # Main application entry
│   ├── common.js          # Shared utilities
│   ├── index.html         # HTML template
│   ├── nexrad_archive.js  # NEXRAD archive reader
│   ├── nexrad-level2.js   # Level 2 data parser
│   ├── radar-sites.js     # NEXRAD site definitions
│   └── styles.css         # Application styles
├── dist/                  # Production build output
├── package.json
├── webpack.config.js
└── README.md
```

## Data Source

Radar data is sourced from the [NOAA NEXRAD Level 2 Archive](https://registry.opendata.aws/noaa-nexrad/) hosted on AWS S3.

## License

ISC

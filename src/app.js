/**
 * NEXRAD Radar Viewer - Main Application (Refactored)
 * Coordinates between modules for the radar data viewer
 */

import './styles.css';

// Module imports
import * as MapManager from './modules/map-manager.js';
import * as DataLoader from './modules/data-loader.js';
import * as RadarDisplay from './modules/radar-display.js';
import * as ZoomFeature from './modules/zoom-feature.js';
import * as UIController from './modules/ui-controller.js';
import * as CrossSection from './modules/cross-section.js';

// Application state
let selectedSite = null;
let selectedDate = null;
let selectedTime = null;
let radarFileData = null;

/**
 * Initialize the application
 */
async function initializeApp() {
    try {
        await google.maps.importLibrary("maps");
        await google.maps.importLibrary("marker");

        // Initialize map with site selection callback
        MapManager.initMap(handleSiteSelection);

        // Setup UI
        UIController.populateYearSelector();
        UIController.initializeDataInfoCardToggle();
        setupEventHandlers();

        console.log('Application initialized successfully');
    } catch (error) {
        console.error('Error loading Google Maps:', error);
        document.getElementById('map').innerHTML = `
            <div style="padding: 20px; text-align: center; color: #721c24;">
                <p>Failed to load Google Maps</p>
                <p>Please check your API key</p>
            </div>
        `;
    }
}

/**
 * Setup all event handlers
 */
function setupEventHandlers() {
    // Site search
    document.getElementById('siteSearch').addEventListener('input', (e) => {
        MapManager.filterMarkers(e.target.value);
    });

    // Select Radar button
    document.getElementById('selectRadarBtn').addEventListener('click', () => {
        if (selectedSite) {
            UIController.progressToStep2(selectedSite);
        }
    });

    // Year selector
    document.getElementById('yearSelect').addEventListener('change', async () => {
        const yearSelect = document.getElementById('yearSelect');
        const monthSelect = document.getElementById('monthSelect');

        monthSelect.disabled = !yearSelect.value;
        monthSelect.value = '';
        document.getElementById('daySelect').value = '';
        document.getElementById('daySelect').disabled = true;

        selectedDate = null;
        MapManager.setAvailableSites(null);
        UIController.showStatus('dataStatus', '', '');

        if (yearSelect.value) {
            UIController.populateMonthSelector();
        }
    });

    // Month selector
    document.getElementById('monthSelect').addEventListener('change', async () => {
        const monthSelect = document.getElementById('monthSelect');
        const daySelect = document.getElementById('daySelect');

        daySelect.disabled = !monthSelect.value;
        daySelect.value = '';

        selectedDate = null;
        MapManager.setAvailableSites(null);
        UIController.showStatus('dataStatus', '', '');

        if (monthSelect.value) {
            UIController.populateDaySelector();
        }
    });

    // Day selector
    document.getElementById('daySelect').addEventListener('change', () => {
        if (document.getElementById('daySelect').value) {
            handleDateSelection();
        }
    });

    // Resolution selector
    document.getElementById('resolutionSelect').addEventListener('change', (e) => {
        if (radarFileData) {
            const scans = DataLoader.filterScansByResolution(radarFileData.nexradFile, e.target.value);
            UIController.populateScanLevelSelector(scans);
        }
    });

    // Scan level selector
    document.getElementById('scanLevelSelect').addEventListener('change', async (e) => {
        const scanIndex = parseInt(e.target.value);
        if (!isNaN(scanIndex) && radarFileData) {
            await handleScanDisplay(scanIndex);
        }
    });

    // Reset button
    document.getElementById('resetBtn').addEventListener('click', handleReset);
}

/**
 * Handle site selection
 */
function handleSiteSelection(site) {
    selectedSite = site;
    UIController.updateSelectedSiteDisplay(site);
}

/**
 * Handle date selection
 */
async function handleDateSelection() {
    const year = document.getElementById('yearSelect').value;
    const month = document.getElementById('monthSelect').value;
    const day = document.getElementById('daySelect').value;

    if (!year || !month || !day) return;

    selectedDate = `${year}/${month}/${day}`;

    try {
        UIController.showStatus('dataStatus', 'loading',
            '<span class="spinner"></span> Fetching available radar sites for selected date...');

        const sites = await DataLoader.fetchAvailableSitesForDate(selectedDate);

        MapManager.setAvailableSites(sites);

        UIController.showStatus('dataStatus', 'success',
            `<span class="checkmark">✓</span> ${sites.length} radar sites available for selected date. Click on a site marker to load data.`);

        if (selectedSite) {
            await checkDataAvailability();
        }
    } catch (error) {
        console.error('Error fetching available sites:', error);
        UIController.showStatus('dataStatus', 'warning',
            `Unable to fetch available sites. All sites shown.<br><small>${error.message}</small>`);
        MapManager.setAvailableSites(null);
    }
}

/**
 * Check data availability for selected site and date
 */
async function checkDataAvailability() {
    if (!selectedSite || !selectedDate) return;

    try {
        UIController.showStatus('dataStatus', 'loading',
            '<span class="spinner"></span> Checking data availability...');

        const result = await DataLoader.checkDataAvailability(selectedSite, selectedDate);

        if (result.available) {
            UIController.showStatus('dataStatus', 'success',
                `<span class="checkmark">✓</span> Data available: ${result.files.length} files found`);

            const times = DataLoader.extractTimesFromFiles(result.files);
            UIController.displayAvailableTimes(times, handleTimeSelection);
        } else {
            UIController.showStatus('dataStatus', 'error',
                `<span class="error-icon">✗</span> No data available for ${selectedSite.code} on ${selectedDate}`);
            document.getElementById('timeSelector').style.display = 'none';
        }
    } catch (error) {
        console.error('Error checking data availability:', error);
        UIController.showStatus('dataStatus', 'error',
            `<span class="error-icon">✗</span> Failed to check data availability<br><small>${error.message}</small>`);
    }
}

/**
 * Handle time selection
 */
async function handleTimeSelection(time) {
    selectedTime = time.fileName;

    // Progress to Step 3
    UIController.progressToStep3(selectedDate, time.display);

    // Load radar data
    await loadRadarData();
}

/**
 * Load radar data
 */
async function loadRadarData() {
    UIController.showStatus('radarStatus', 'loading',
        '<span class="spinner"></span> Loading radar data...');

    // Hide legend and zoom during load
    RadarDisplay.hideLegend();
    ZoomFeature.disableZoomFeature();

    // Clear markers and zoom to radar
    MapManager.clearMarkers();
    const radarCenter = { lat: selectedSite.lat, lng: selectedSite.lon };
    MapManager.zoomToRadar(radarCenter);
    MapManager.createLoadingMarker(radarCenter);
    MapManager.restrictMapToRadarArea(radarCenter);

    try {
        radarFileData = await DataLoader.loadRadarData(selectedSite, selectedDate, selectedTime);

        // Make globally accessible for compatibility
        window.radarFileData = radarFileData;

        // Create range rings and crosshair using effective max range
        const displayRange = radarFileData.effectiveMaxRange || radarFileData.maxRange;
        MapManager.createRangeRings(radarCenter, displayRange, 5);
        MapManager.createCrosshair(radarCenter, displayRange);

        // Show map controls and disable map dragging
        MapManager.showMapControls();
        MapManager.disableMapDragging();

        // Remove loading marker
        MapManager.removeLoadingMarker();

        // Update UI
        UIController.showStatus('radarStatus', 'success',
            '<span class="checkmark">✓</span> Radar data loaded successfully! Select resolution and scan level to display.');

        UIController.updateRadarInfoCard(radarFileData);

        // Reset resolution and scan selectors
        document.getElementById('resolutionSelect').value = '';
        document.getElementById('scanLevelSelect').innerHTML = '<option value="">Select Resolution First</option>';
        document.getElementById('scanLevelSelect').disabled = true;

        console.log(`Radar data loaded: ${radarFileData.nexradFile.nscans} scan levels`);

    } catch (error) {
        console.error('Error loading radar data:', error);
        MapManager.removeLoadingMarker();
        UIController.showStatus('radarStatus', 'error',
            `<span class="error-icon">✗</span> Failed to load radar data<br><small>${error.message}</small>`);
    }
}

/**
 * Handle scan display
 */
async function handleScanDisplay(scanIndex) {
    try {
        UIController.showStatus('radarStatus', 'loading',
            '<span class="spinner"></span> Generating heatmap...');

        const scanDetails = await RadarDisplay.displayRadarHeatmap(radarFileData, scanIndex);

        UIController.showStatus('radarStatus', 'success',
            `<span class="checkmark">✓</span> Scan displayed successfully! ${scanDetails.nrays} radials × ${scanDetails.ngates} gates`);

        UIController.updateScanInfoCard(scanDetails);
        RadarDisplay.updateLegend(scanDetails.minVal, scanDetails.maxVal);
        // Use global effective max range (across all scans) for hover ray
        const globalEffectiveRange = radarFileData.effectiveMaxRange || scanDetails.effectiveMaxRange;
        ZoomFeature.enableZoomFeature(radarFileData, globalEffectiveRange);
        CrossSection.enableCrossSection();

    } catch (error) {
        console.error('Error displaying radar heatmap:', error);
        UIController.showStatus('radarStatus', 'error',
            `<span class="error-icon">✗</span> ${error.message}`);
    }
}

/**
 * Handle reset
 */
function handleReset() {
    console.log('Resetting application');

    // Reset state
    selectedSite = null;
    selectedDate = null;
    selectedTime = null;
    radarFileData = null;
    window.radarFileData = null;

    // Reset UI
    UIController.resetUI();

    // Reset map
    MapManager.resetMap();

    // Disable features
    RadarDisplay.hideLegend();
    ZoomFeature.disableZoomFeature();
    CrossSection.disableCrossSection();
    MapManager.hideMapControls();
    MapManager.enableMapDragging();

    console.log('Application reset complete');
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    initializeApp();
});

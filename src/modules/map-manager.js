/**
 * Map Management Module
 * Handles Google Maps initialization, markers, overlays, and interactions
 */

import { NEXRAD_SITES } from '../radar-sites.js';

// Map state
let map = null;
let markers = [];
let selectedSite = null;
let availableSites = null;
let infoWindow = null;
let rangeRings = [];
let crosshairLines = [];
let radarOverlay = null;
let loadingMarker = null;

// Constants
const MAP_CONFIG = {
    DEFAULT_CENTER: { lat: 39.8283, lng: -98.5795 },
    DEFAULT_ZOOM: 4,
    RADAR_ZOOM: 8,
    MAP_ID: 'DEMO_MAP_ID'
};

const COLORS = {
    MARKER_AVAILABLE: '#D4A017',
    MARKER_SELECTED: '#16A34A',
    MARKER_UNAVAILABLE: '#DC2626',
    CROSSHAIR: '#666666'
};

/**
 * Initialize the Google Map
 */
export function initMap(onSiteSelect) {
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: MAP_CONFIG.DEFAULT_ZOOM,
        center: MAP_CONFIG.DEFAULT_CENTER,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        zoomControl: false,  // Disabled - using custom controls
        panControl: false,   // Disabled - using custom controls
        mapId: MAP_CONFIG.MAP_ID
    });

    infoWindow = new google.maps.InfoWindow();

    // Create markers for all NEXRAD sites
    NEXRAD_SITES.forEach(site => {
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map: map,
            position: { lat: site.lat, lng: site.lon },
            title: `${site.code} - ${site.name}, ${site.state}`,
            content: createMarkerContent(site)
        });

        marker.addListener('click', () => {
            selectSite(site, marker, onSiteSelect);
        });

        markers.push({ marker, site });
    });

    // Initialize custom map controls
    initializeMapControls();

    console.log(`Initialized map with ${markers.length} radar sites`);
}

/**
 * Initialize custom map controls (zoom and pan)
 */
function initializeMapControls() {
    const mapZoomIn = document.getElementById('mapZoomIn');
    const mapZoomOut = document.getElementById('mapZoomOut');
    const mapPanUp = document.getElementById('mapPanUp');
    const mapPanDown = document.getElementById('mapPanDown');
    const mapPanLeft = document.getElementById('mapPanLeft');
    const mapPanRight = document.getElementById('mapPanRight');

    // Zoom controls
    if (mapZoomIn) {
        mapZoomIn.addEventListener('click', () => {
            if (!map) {
                console.error('Map not initialized');
                return;
            }
            const currentZoom = map.getZoom();
            map.setZoom(currentZoom + 1);
            console.log(`Zoomed in to level ${currentZoom + 1}`);
        });
    } else {
        console.warn('mapZoomIn button not found');
    }

    if (mapZoomOut) {
        mapZoomOut.addEventListener('click', () => {
            if (!map) {
                console.error('Map not initialized');
                return;
            }
            const currentZoom = map.getZoom();
            map.setZoom(currentZoom - 1);
            console.log(`Zoomed out to level ${currentZoom - 1}`);
        });
    } else {
        console.warn('mapZoomOut button not found');
    }

    // Pan controls - move by 25% of viewport
    const PAN_FRACTION = 0.25;

    if (mapPanUp) {
        mapPanUp.addEventListener('click', () => {
            const center = map.getCenter();
            const bounds = map.getBounds();
            if (!bounds) return;

            const latDelta = (bounds.getNorthEast().lat() - bounds.getSouthWest().lat()) * PAN_FRACTION;
            map.panTo({
                lat: center.lat() + latDelta,
                lng: center.lng()
            });
        });
    }

    if (mapPanDown) {
        mapPanDown.addEventListener('click', () => {
            const center = map.getCenter();
            const bounds = map.getBounds();
            if (!bounds) return;

            const latDelta = (bounds.getNorthEast().lat() - bounds.getSouthWest().lat()) * PAN_FRACTION;
            map.panTo({
                lat: center.lat() - latDelta,
                lng: center.lng()
            });
        });
    }

    if (mapPanLeft) {
        mapPanLeft.addEventListener('click', () => {
            const center = map.getCenter();
            const bounds = map.getBounds();
            if (!bounds) return;

            const lngDelta = (bounds.getNorthEast().lng() - bounds.getSouthWest().lng()) * PAN_FRACTION;
            map.panTo({
                lat: center.lat(),
                lng: center.lng() - lngDelta
            });
        });
    }

    if (mapPanRight) {
        mapPanRight.addEventListener('click', () => {
            const center = map.getCenter();
            const bounds = map.getBounds();
            if (!bounds) return;

            const lngDelta = (bounds.getNorthEast().lng() - bounds.getSouthWest().lng()) * PAN_FRACTION;
            map.panTo({
                lat: center.lat(),
                lng: center.lng() + lngDelta
            });
        });
    }

    console.log('Custom map controls initialized');
}

/**
 * Create custom marker content
 */
function createMarkerContent(site) {
    const pin = document.createElement('div');
    pin.className = 'custom-marker';
    pin.style.backgroundColor = COLORS.MARKER_AVAILABLE;
    pin.dataset.siteCode = site.code;
    return pin;
}

/**
 * Select a radar site
 */
function selectSite(site, marker, onSiteSelect) {
    selectedSite = site;

    // Show info window
    const content = `
        <div class="site-info-window">
            <h4>${site.code}</h4>
            <p>${site.name}, ${site.state}</p>
            <p>Lat: ${site.lat.toFixed(4)}, Lon: ${site.lon.toFixed(4)}</p>
        </div>
    `;

    infoWindow.setContent(content);
    infoWindow.open(map, marker);

    // Update marker colors
    markers.forEach(({ marker: m, site: s }) => {
        if (m.content) {
            m.content.style.backgroundColor = s.code === site.code ? COLORS.MARKER_SELECTED : COLORS.MARKER_AVAILABLE;
            m.content.style.transform = s.code === site.code ? 'scale(1.2)' : 'scale(1)';
        }
    });

    // Notify callback
    if (onSiteSelect) {
        onSiteSelect(site);
    }
}

/**
 * Filter markers based on search term and availability
 */
export function filterMarkers(searchTerm) {
    const search = searchTerm.toLowerCase();

    markers.forEach(({ marker, site }) => {
        const matchesSearch = site.code.toLowerCase().includes(search) ||
                             site.name.toLowerCase().includes(search) ||
                             site.state.toLowerCase().includes(search);

        const isAvailable = availableSites === null || availableSites.includes(site.code);

        // Keep all markers visible
        marker.map = map;

        // Update marker appearance
        if (marker.content) {
            if (!matchesSearch) {
                marker.content.style.backgroundColor = COLORS.MARKER_UNAVAILABLE;
                marker.content.style.opacity = '1';
                marker.content.style.transform = 'scale(1)';
            } else if (!isAvailable) {
                marker.content.style.backgroundColor = COLORS.MARKER_UNAVAILABLE;
                marker.content.style.opacity = '1';
                marker.content.style.transform = 'scale(1)';
            } else if (site.code === selectedSite?.code) {
                marker.content.style.backgroundColor = COLORS.MARKER_SELECTED;
                marker.content.style.transform = 'scale(1.2)';
                marker.content.style.opacity = '1';
            } else {
                marker.content.style.backgroundColor = COLORS.MARKER_AVAILABLE;
                marker.content.style.transform = 'scale(1)';
                marker.content.style.opacity = '1';
            }
        }
    });
}

/**
 * Set available sites list
 */
export function setAvailableSites(sites) {
    availableSites = sites;
    filterMarkers(document.getElementById('siteSearch')?.value || '');
}

/**
 * Zoom to radar location
 */
export function zoomToRadar(radarCenter) {
    map.setCenter(radarCenter);
    map.setZoom(MAP_CONFIG.RADAR_ZOOM);
}

/**
 * Reset map to default view
 */
export function resetMap() {
    selectedSite = null;
    availableSites = null;

    // Remove overlays
    clearRangeRings();
    clearCrosshair();
    clearRadarOverlay();
    removeLoadingMarker();
    removeMapRestrictions();

    // Reset markers
    filterMarkers('');

    // Reset view
    map.setCenter(MAP_CONFIG.DEFAULT_CENTER);
    map.setZoom(MAP_CONFIG.DEFAULT_ZOOM);

    // Close info window
    if (infoWindow) {
        infoWindow.close();
    }
}

/**
 * Create range ring circles
 */
export function createRangeRings(center, maxRange, numRings = 5) {
    clearRangeRings();

    const interval = maxRange / numRings;
    for (let i = 1; i <= numRings; i++) {
        const radius = interval * i;
        const circle = new google.maps.Circle({
            strokeColor: COLORS.CROSSHAIR,
            strokeOpacity: 0.6,
            strokeWeight: 1.5,
            fillColor: 'transparent',
            fillOpacity: 0,
            map: map,
            center: center,
            radius: radius,
            clickable: false,
            zIndex: 1
        });
        rangeRings.push(circle);
    }

    console.log(`Created ${numRings} range rings, max range: ${(maxRange / 1000).toFixed(1)} km`);
}

/**
 * Create crosshair overlay
 */
export function createCrosshair(center, maxRange) {
    clearCrosshair();

    const latOffset = (maxRange / 1000) / 111;
    const lngOffset = (maxRange / 1000) / (111 * Math.cos(center.lat * Math.PI / 180));

    const horizontalLine = new google.maps.Polyline({
        path: [
            { lat: center.lat, lng: center.lng - lngOffset },
            { lat: center.lat, lng: center.lng + lngOffset }
        ],
        strokeColor: COLORS.CROSSHAIR,
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        geodesic: false,
        map: map,
        clickable: false,
        zIndex: 2
    });

    const verticalLine = new google.maps.Polyline({
        path: [
            { lat: center.lat - latOffset, lng: center.lng },
            { lat: center.lat + latOffset, lng: center.lng }
        ],
        strokeColor: COLORS.CROSSHAIR,
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        geodesic: false,
        map: map,
        clickable: false,
        zIndex: 2
    });

    crosshairLines.push(verticalLine, horizontalLine);
}

/**
 * Clear range rings
 */
function clearRangeRings() {
    rangeRings.forEach(ring => ring.setMap(null));
    rangeRings = [];
}

/**
 * Clear crosshair
 */
function clearCrosshair() {
    crosshairLines.forEach(line => line.setMap(null));
    crosshairLines = [];
}

/**
 * Set radar overlay
 */
export function setRadarOverlay(imageUrl, bounds, opacity = 0.7) {
    clearRadarOverlay();

    radarOverlay = new google.maps.GroundOverlay(imageUrl, bounds, {
        opacity: opacity,
        clickable: false
    });

    radarOverlay.setMap(map);
}

/**
 * Clear radar overlay
 */
function clearRadarOverlay() {
    if (radarOverlay) {
        radarOverlay.setMap(null);
        radarOverlay = null;
    }
}

/**
 * Create loading marker
 */
export function createLoadingMarker(position) {
    removeLoadingMarker();

    const markerContent = document.createElement('div');
    markerContent.className = 'radar-loading-marker';

    const iconDiv = document.createElement('div');
    iconDiv.className = 'radar-loading-marker__icon';
    iconDiv.innerHTML = `
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-3.31 0-6 2.69-6 6h2c0-2.21 1.79-4 4-4s4 1.79 4 4h2c0-3.31-2.69-6-6-6z"/>
        </svg>
    `;

    const textDiv = document.createElement('div');
    textDiv.className = 'radar-loading-marker__text';
    textDiv.innerHTML = '<span>Loading</span><span class="radar-loading-marker__spinner"></span>';

    markerContent.appendChild(iconDiv);
    markerContent.appendChild(textDiv);

    loadingMarker = new google.maps.marker.AdvancedMarkerElement({
        position: position,
        map: map,
        content: markerContent,
        title: 'Loading radar data'
    });
}

/**
 * Remove loading marker
 */
export function removeLoadingMarker() {
    if (loadingMarker) {
        loadingMarker.map = null;
        loadingMarker = null;
    }
}

/**
 * Restrict map interaction to radar area
 */
export function restrictMapToRadarArea(radarCenter) {
    const latOffset = 2.7;
    const lngOffset = 3.5;

    const bounds = {
        north: radarCenter.lat + latOffset,
        south: radarCenter.lat - latOffset,
        east: radarCenter.lng + lngOffset,
        west: radarCenter.lng - lngOffset
    };

    map.setOptions({
        restriction: {
            latLngBounds: bounds,
            strictBounds: false
        },
        minZoom: 7,
        maxZoom: 12,
        gestureHandling: 'greedy'
    });
}

/**
 * Remove map restrictions
 */
export function removeMapRestrictions() {
    map.setOptions({
        restriction: null,
        minZoom: 3,
        maxZoom: 20,
        gestureHandling: 'greedy'
    });
}

/**
 * Get map instance
 */
export function getMap() {
    return map;
}

/**
 * Get selected site
 */
export function getSelectedSite() {
    return selectedSite;
}

/**
 * Clear markers from map
 */
export function clearMarkers() {
    markers.forEach(({ marker }) => {
        marker.map = null;
    });
}

/**
 * Restore markers to map
 */
export function restoreMarkers() {
    filterMarkers(document.getElementById('siteSearch')?.value || '');
}

/**
 * Show map controls
 */
export function showMapControls() {
    const mapControls = document.getElementById('mapControls');
    if (mapControls) {
        mapControls.style.display = 'block';
        console.log('Map controls shown');
    } else {
        console.error('mapControls element not found');
    }
}

/**
 * Hide map controls
 */
export function hideMapControls() {
    const mapControls = document.getElementById('mapControls');
    if (mapControls) {
        mapControls.style.display = 'none';
        console.log('Map controls hidden');
    }
}

/**
 * Disable map dragging/panning
 */
export function disableMapDragging() {
    if (map) {
        map.setOptions({ draggable: false });
        console.log('Map dragging disabled');
    }
}

/**
 * Enable map dragging/panning
 */
export function enableMapDragging() {
    if (map) {
        map.setOptions({ draggable: true });
        console.log('Map dragging enabled');
    }
}

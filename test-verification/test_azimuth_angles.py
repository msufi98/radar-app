"""
Azimuth Angle Verification Test (Python/PyART version)
Tests reflectivity values at specific azimuth angles (30°, 60°, 180°, 359°)
Compares hi-res and regular resolution data
"""

import pyart
import numpy as np
import json
from pathlib import Path
from datetime import datetime

# Test files - same as JavaScript version
TEST_FILES = [
    {
        'name': 'KHGX-2022',
        'uri': 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06',
        'description': 'Houston, TX - March 2022'
    },
    {
        'name': 'KBBX-2016',
        'uri': 's3://unidata-nexrad-level2/2016/12/10/KBBX/KBBX20161210_003057_V06',
        'description': 'Beale AFB, CA - December 2016'
    },
    {
        'name': 'KCBW-2000',
        'uri': 's3://unidata-nexrad-level2/2000/08/08/KCBW/KCBW20000808_003027.gz',
        'description': 'Houlton, ME - August 2000'
    }
]

# Target azimuth angles to test
TARGET_AZIMUTHS = [30, 60, 180, 359]


def find_radial_at_azimuth(radar, sweep_idx, target_azimuth):
    """Find radial index closest to target azimuth"""
    sweep_start = radar.sweep_start_ray_index['data'][sweep_idx]
    sweep_end = radar.sweep_end_ray_index['data'][sweep_idx]

    azimuths = radar.azimuth['data'][sweep_start:sweep_end+1]

    # Find closest azimuth
    diffs = np.abs(azimuths - target_azimuth)

    # Handle wrap-around at 360°
    diffs = np.minimum(diffs, 360 - diffs)

    closest_idx = np.argmin(diffs)
    absolute_idx = sweep_start + closest_idx

    return absolute_idx, azimuths[closest_idx]


def extract_reflectivity_values(data, gates=[0, 10, 50, 100, 200, 500, 1000]):
    """Extract reflectivity values at specific gates"""
    values = {}
    for gate in gates:
        if gate < len(data):
            val = data[gate]
            # Convert masked array to regular value
            if np.ma.is_masked(val):
                values[f'gate_{gate}'] = None
            else:
                values[f'gate_{gate}'] = float(val)
        else:
            values[f'gate_{gate}'] = None
    return values


def calculate_stats(data):
    """Calculate statistics for an array"""
    # Handle masked arrays
    if np.ma.is_masked(data):
        valid_data = data[~data.mask]
    else:
        valid_data = data[~np.isnan(data)]

    if len(valid_data) == 0:
        return {
            'count': len(data),
            'valid': 0,
            'null': len(data),
            'min': None,
            'max': None,
            'mean': None,
            'std': None
        }

    return {
        'count': int(len(data)),
        'valid': int(len(valid_data)),
        'null': int(len(data) - len(valid_data)),
        'min': float(np.min(valid_data)),
        'max': float(np.max(valid_data)),
        'mean': float(np.mean(valid_data)),
        'std': float(np.std(valid_data))
    }


def convert_to_serializable(obj):
    """Convert numpy types to Python native types for JSON serialization"""
    if isinstance(obj, (np.integer, np.int32, np.int64)):
        return int(obj)
    elif isinstance(obj, (np.floating, np.float32, np.float64)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, np.ma.core.MaskedArray):
        # Convert masked array to list with None for masked values
        return [None if np.ma.is_masked(item) else float(item) for item in obj]
    elif obj is np.ma.masked:
        return None
    elif isinstance(obj, dict):
        return {k: convert_to_serializable(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_to_serializable(item) for item in obj]
    return obj


def test_file(file_info):
    """Test a single file"""
    print('\n' + '=' * 80)
    print(f"Testing: {file_info['name']}")
    print(f"Description: {file_info['description']}")
    print(f"URI: {file_info['uri']}")
    print('=' * 80)

    try:
        # Read the file
        print('\nReading NEXRAD file with PyART...')
        radar = pyart.io.read_nexrad_archive(file_info['uri'])

        print(f"\n[OK] File loaded successfully")
        print(f"  - Site: {radar.metadata.get('instrument_name', 'Unknown')}")
        print(f"  - VCP: {radar.metadata.get('vcp_pattern', 'Unknown')}")
        print(f"  - Total Sweeps: {radar.nsweeps}")
        print(f"  - Total Rays: {radar.nrays}")

        results = {
            'file': file_info['name'],
            'uri': file_info['uri'],
            'site': radar.metadata.get('instrument_name', 'Unknown'),
            'vcp': int(radar.metadata.get('vcp_pattern', 0)),
            'scans': []
        }

        # Test each sweep (first few sweeps)
        sweeps_to_test = min(3, radar.nsweeps)

        for sweep_idx in range(sweeps_to_test):
            sweep_start = radar.sweep_start_ray_index['data'][sweep_idx]
            sweep_end = radar.sweep_end_ray_index['data'][sweep_idx]
            n_rays = sweep_end - sweep_start + 1

            elevation = radar.elevation['data'][sweep_start]

            print(f"\n--- Sweep {sweep_idx} ---")
            print(f"  Elevation: {elevation:.2f}°")
            print(f"  Rays: {n_rays}")

            # Get reflectivity field
            ref_field = None
            for field_name in ['reflectivity', 'REF', 'DBZ']:
                if field_name in radar.fields:
                    ref_field = field_name
                    break

            if ref_field is None:
                print(f"  [WARN] No reflectivity field found")
                continue

            # Get range information
            range_data = radar.range['data']
            gate_spacing = range_data[1] - range_data[0] if len(range_data) > 1 else 0
            max_gates = len(range_data)

            print(f"  Max Gates (REF): {max_gates}")
            print(f"  Range: {range_data[0]:.0f}m to {range_data[-1]:.0f}m")
            print(f"  Gate Spacing: {gate_spacing:.0f}m")

            # Determine if this is hi-res or regular
            is_hires = gate_spacing <= 250
            print(f"  Resolution: {'HI-RES' if is_hires else 'REGULAR'}")

            scan_result = {
                'scan_index': sweep_idx,
                'elevation': float(elevation),
                'radials': n_rays,
                'resolution': 'hi-res' if is_hires else 'regular',
                'gate_spacing': float(gate_spacing),
                'max_gates': max_gates,
                'azimuths': []
            }

            # Test each target azimuth
            for target_az in TARGET_AZIMUTHS:
                try:
                    radial_idx, actual_az = find_radial_at_azimuth(radar, sweep_idx, target_az)
                    az_diff = abs(actual_az - target_az)

                    print(f"\n  Azimuth {target_az}°:")
                    print(f"    Actual azimuth: {actual_az:.2f}° (diff: {az_diff:.2f}°)")
                    print(f"    Ray index: {radial_idx}")

                    # Get REF data for this ray
                    ref_data = radar.fields[ref_field]['data'][radial_idx, :]

                    # Extract sample values
                    sample_values = extract_reflectivity_values(ref_data)
                    stats = calculate_stats(ref_data)

                    print(f"    Valid/Total: {stats['valid']}/{stats['count']}")
                    if stats['min'] is not None:
                        print(f"    Range: {stats['min']:.2f} to {stats['max']:.2f} dBZ")
                        print(f"    Mean: {stats['mean']:.2f} dBZ")
                        print(f"    Std Dev: {stats['std']:.2f} dBZ")
                    print(f"    Sample values:")
                    for gate, value in sample_values.items():
                        val_str = 'null' if value is None else f"{value:.2f} dBZ"
                        print(f"      {gate}: {val_str}")

                    # Convert full data to serializable format
                    full_data = convert_to_serializable(ref_data)

                    scan_result['azimuths'].append({
                        'target_azimuth': target_az,
                        'actual_azimuth': float(actual_az),
                        'azimuth_diff': float(az_diff),
                        'radial_index': int(radial_idx),
                        'statistics': stats,
                        'sample_values': sample_values,
                        'full_data': full_data
                    })

                except Exception as e:
                    print(f"  [WARN] Error processing azimuth {target_az}: {e}")
                    continue

            results['scans'].append(scan_result)

        return results

    except Exception as error:
        print(f"\n[ERROR] Error testing file: {error}")
        import traceback
        traceback.print_exc()
        return {
            'file': file_info['name'],
            'uri': file_info['uri'],
            'error': str(error)
        }


def run_tests():
    """Main test function"""
    print('=' * 80)
    print('NEXRAD Azimuth Angle Verification Test (PyART)')
    print('=' * 80)
    print(f"\nTesting {len(TEST_FILES)} files")
    print(f"Target azimuths: {', '.join(map(str, TARGET_AZIMUTHS))}°")
    print(f"Testing both hi-res and regular resolution data")

    all_results = {
        'test_date': datetime.now().isoformat(),
        'test_description': 'Reflectivity values at specific azimuth angles (PyART)',
        'target_azimuths': TARGET_AZIMUTHS,
        'files': []
    }

    # Test each file
    for file_info in TEST_FILES:
        result = test_file(file_info)
        all_results['files'].append(result)

    # Save results
    output_dir = Path(__file__).parent / 'output'
    output_dir.mkdir(exist_ok=True)

    output_path = output_dir / 'azimuth_test_py.json'
    # Convert all numpy types to JSON serializable types
    serializable_results = convert_to_serializable(all_results)
    with open(output_path, 'w') as f:
        json.dump(serializable_results, f, indent=2)

    print('\n' + '=' * 80)
    print('Test Complete')
    print('=' * 80)
    print(f"[OK] Results saved to: {output_path}")
    print('\nNext steps:')
    print('1. Compare azimuth_test_js.json with azimuth_test_py.json')
    print('2. Verify reflectivity values match at all tested angles')
    print('3. Check both hi-res and regular resolution data')


if __name__ == '__main__':
    run_tests()

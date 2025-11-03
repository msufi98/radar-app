"""
Deep Data Comparison - Compare actual REF values (Python)
Verifies that decompression and scaling produce identical numerical results
"""

import pyart
from pyart.io.nexrad_level2 import NEXRADLevel2File
from pyart.io.common import prepare_for_read
import json
import numpy as np

# Test with KHGX file (most comprehensive)
TEST_FILE = 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06'

def compare_data_values():
    print('=' * 80)
    print('Deep Data Value Comparison: Python/PyART')
    print('=' * 80)
    print(f'\nTest File: {TEST_FILE}\n')

    # Read with Python
    print('Reading with Python/PyART...')
    file_handle = prepare_for_read(TEST_FILE, storage_options={'anon': True})
    nexrad_file = NEXRADLevel2File(file_handle)

    # Get REF data
    print('Extracting REF moment data...')
    range_info = nexrad_file.get_range(0, 'REF')
    max_ngates = len(range_info)
    ref_data = nexrad_file.get_data('REF', max_ngates)

    print(f'\nPython REF Data Shape: {ref_data.shape}')

    # Calculate statistics for all radials
    stats = {
        'total_radials': ref_data.shape[0],
        'total_gates': ref_data.shape[1],
        'total_values': ref_data.size,
        'valid_values': 0,
        'null_values': 0,

        # Per-radial statistics
        'radial_samples': [],

        # Overall statistics (excluding nulls/masked)
        'all_valid_values': [],
        'min': None,
        'max': None,
        'mean': None,

        # Sample radials for detailed comparison
        'sample_radials': [0, 100, 500, 1000, 5000, 10000]
    }

    # Collect statistics
    for radial in range(ref_data.shape[0]):
        radial_data = ref_data[radial, :]

        # Count valid vs masked/null values
        if np.ma.is_masked(radial_data):
            valid_mask = ~radial_data.mask
            valid_values = radial_data[valid_mask]
            valid_count = valid_values.size
            null_count = radial_data.size - valid_count
        else:
            valid_mask = ~np.isnan(radial_data)
            valid_values = radial_data[valid_mask]
            valid_count = valid_values.size
            null_count = radial_data.size - valid_count

        stats['valid_values'] += valid_count
        stats['null_values'] += null_count

        # Store sample radials
        if radial in stats['sample_radials']:
            radial_min = float(np.min(valid_values)) if valid_count > 0 else None
            radial_max = float(np.max(valid_values)) if valid_count > 0 else None
            radial_mean = float(np.mean(valid_values)) if valid_count > 0 else None

            # Convert first 20 values to list (handle masked values)
            values_sample = []
            for i in range(min(20, radial_data.size)):
                val = radial_data[i]
                if np.ma.is_masked(val) or np.isnan(val):
                    values_sample.append(None)
                else:
                    values_sample.append(float(val))

            # Get specific gate values
            gate_samples = {}
            for gate_idx in [0, 100, 500, 1000, 1500]:
                if gate_idx < radial_data.size:
                    val = radial_data[gate_idx]
                    if np.ma.is_masked(val) or np.isnan(val):
                        gate_samples[f'gate_{gate_idx}'] = None
                    else:
                        gate_samples[f'gate_{gate_idx}'] = float(val)

            stats['radial_samples'].append({
                'radial_index': radial,
                'total_gates': int(radial_data.size),
                'valid_count': int(valid_count),
                'null_count': int(null_count),
                'min': radial_min,
                'max': radial_max,
                'mean': radial_mean,
                'values_sample': values_sample,
                'gate_samples': gate_samples
            })

        # Add valid values to overall list
        if valid_count > 0:
            stats['all_valid_values'].extend(valid_values.tolist())

    # Calculate overall statistics
    if len(stats['all_valid_values']) > 0:
        stats['min'] = float(np.min(stats['all_valid_values']))
        stats['max'] = float(np.max(stats['all_valid_values']))
        stats['mean'] = float(np.mean(stats['all_valid_values']))

    # Print summary statistics
    print('\n' + '=' * 80)
    print('Python REF Data Statistics')
    print('=' * 80)
    print(f"Total Values: {stats['total_values']:,}")
    print(f"Valid Values: {stats['valid_values']:,} ({stats['valid_values'] / stats['total_values'] * 100:.2f}%)")
    print(f"Null Values: {stats['null_values']:,} ({stats['null_values'] / stats['total_values'] * 100:.2f}%)")
    print(f"\nOverall Statistics (valid values only):")
    print(f"  Min: {stats['min']:.4f}" if stats['min'] is not None else "  Min: None")
    print(f"  Max: {stats['max']:.4f}" if stats['max'] is not None else "  Max: None")
    print(f"  Mean: {stats['mean']:.4f}" if stats['mean'] is not None else "  Mean: None")

    # Print sample radials
    print('\n' + '=' * 80)
    print('Sample Radials (for JavaScript comparison)')
    print('=' * 80)

    for sample in stats['radial_samples']:
        print(f"\nRadial {sample['radial_index']}:")
        print(f"  Valid: {sample['valid_count']}, Null: {sample['null_count']}")
        if sample['min'] is not None:
            print(f"  Min: {sample['min']:.4f}, Max: {sample['max']:.4f}, Mean: {sample['mean']:.4f}")
        values_str = ', '.join([
            'null' if v is None else f"{v:.2f}"
            for v in sample['values_sample'][:10]
        ])
        print(f"  First 10 values: [{values_str}]")
        print(f"  Gate samples:")
        for gate, value in sample['gate_samples'].items():
            val_str = 'null' if value is None else f"{value:.4f}"
            print(f"    {gate}: {val_str}")

    # Save detailed results for comparison
    # Convert first radial to list
    first_radial_list = []
    for i in range(ref_data.shape[1]):
        val = ref_data[0, i]
        if np.ma.is_masked(val) or np.isnan(val):
            first_radial_list.append(None)
        else:
            first_radial_list.append(float(val))

    output = {
        'test_file': TEST_FILE,
        'data_shape': list(ref_data.shape),
        'statistics': {
            'total_values': stats['total_values'],
            'valid_values': stats['valid_values'],
            'null_values': stats['null_values'],
            'min': stats['min'],
            'max': stats['max'],
            'mean': stats['mean']
        },
        'radial_samples': stats['radial_samples'],
        'first_radial_full': first_radial_list
    }

    output_path = 'output/data_comparison_py.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2)

    print(f'\n[OK] Detailed results saved to: {output_path}')

    # Compare with JavaScript results if available
    try:
        with open('output/data_comparison_js.json', 'r') as f:
            js_output = json.load(f)

        print('\n' + '=' * 80)
        print('Comparison with JavaScript Results')
        print('=' * 80)

        # Compare overall statistics
        print('\nOverall Statistics Comparison:')
        print(f"  Total Values:  JS={js_output['statistics']['total_values']:,}, "
              f"PY={output['statistics']['total_values']:,}, "
              f"Match={'YES' if js_output['statistics']['total_values'] == output['statistics']['total_values'] else 'NO'}")
        print(f"  Valid Values:  JS={js_output['statistics']['valid_values']:,}, "
              f"PY={output['statistics']['valid_values']:,}, "
              f"Match={'YES' if js_output['statistics']['valid_values'] == output['statistics']['valid_values'] else 'NO'}")
        print(f"  Null Values:   JS={js_output['statistics']['null_values']:,}, "
              f"PY={output['statistics']['null_values']:,}, "
              f"Match={'YES' if js_output['statistics']['null_values'] == output['statistics']['null_values'] else 'NO'}")

        if js_output['statistics']['min'] is not None and output['statistics']['min'] is not None:
            min_diff = abs(js_output['statistics']['min'] - output['statistics']['min'])
            print(f"  Min:           JS={js_output['statistics']['min']:.4f}, "
                  f"PY={output['statistics']['min']:.4f}, "
                  f"Diff={min_diff:.6f}")

        if js_output['statistics']['max'] is not None and output['statistics']['max'] is not None:
            max_diff = abs(js_output['statistics']['max'] - output['statistics']['max'])
            print(f"  Max:           JS={js_output['statistics']['max']:.4f}, "
                  f"PY={output['statistics']['max']:.4f}, "
                  f"Diff={max_diff:.6f}")

        if js_output['statistics']['mean'] is not None and output['statistics']['mean'] is not None:
            mean_diff = abs(js_output['statistics']['mean'] - output['statistics']['mean'])
            print(f"  Mean:          JS={js_output['statistics']['mean']:.4f}, "
                  f"PY={output['statistics']['mean']:.4f}, "
                  f"Diff={mean_diff:.6f}")

        # Compare first radial value by value
        print('\nFirst Radial Comparison (first 10 values):')
        js_first = js_output['first_radial_full'][:10]
        py_first = output['first_radial_full'][:10]
        all_match = True

        for i, (js_val, py_val) in enumerate(zip(js_first, py_first)):
            if js_val is None and py_val is None:
                match = 'OK'
            elif js_val is None or py_val is None:
                match = 'DIFF'
                all_match = False
            else:
                diff = abs(js_val - py_val)
                if diff < 0.01:  # Allow small floating point differences
                    match = 'OK'
                else:
                    match = f'DIFF({diff:.4f})'
                    all_match = False

            js_str = 'null' if js_val is None else f"{js_val:.4f}"
            py_str = 'null' if py_val is None else f"{py_val:.4f}"
            print(f"  Gate {i:3d}: JS={js_str:10s}, PY={py_str:10s} [{match}]")

        print(f"\nFirst Radial Match: {'YES' if all_match else 'NO'}")

    except FileNotFoundError:
        print('\nJavaScript results not found. Run compare_data_values.js first.')

if __name__ == '__main__':
    compare_data_values()

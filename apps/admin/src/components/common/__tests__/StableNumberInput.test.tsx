import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { StableNumberInput, type StableNumberInputProps } from '../StableNumberInput';

function renderControlledNumberInput(
  props: Omit<StableNumberInputProps, 'value' | 'onChange'> & {
    initialValue?: number | null;
  },
) {
  const onChange = vi.fn();

  function Harness() {
    const { initialValue, ...inputProps } = props;
    const [value, setValue] = useState<number | null>(initialValue ?? null);

    return (
      <StableNumberInput
        {...inputProps}
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
      />
    );
  }

  render(<Harness />);
  return onChange;
}

describe('StableNumberInput', () => {
  it('keeps decimal draft while typing', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'amount',
      precision: 2,
    });

    const input = screen.getByLabelText('amount');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.' } });

    expect(input).toHaveValue('0.');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('normalizes precision on blur', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'discount',
      precision: 4,
    });

    const input = screen.getByLabelText('discount');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.95555' } });
    expect(input).toHaveValue('0.95555');

    fireEvent.blur(input);
    expect(input).toHaveValue('0.9556');
    expect(onChange).toHaveBeenLastCalledWith(0.9556);
  });

  it('does not lift a sub-cent amount to 0.01 on blur', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'sub-cent',
      min: 0,
      precision: 2,
    });

    const input = screen.getByLabelText('sub-cent');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0.005' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('0.00');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('keeps typed 0 when min is 0 instead of lifting it to 0.01', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'floor-zero',
      min: 0,
      precision: 2,
    });

    const input = screen.getByLabelText('floor-zero');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.blur(input);

    expect(input).toHaveValue('0.00');
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('applies bounds on blur without changing draft while typing', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'bounded',
      min: 1,
      max: 10,
      precision: 0,
    });

    const input = screen.getByLabelText('bounded');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '0' } });
    expect(input).toHaveValue('0');

    fireEvent.blur(input);
    expect(input).toHaveValue('1');
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('does not emit onChange when blur does not change the value', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'unchanged',
      initialValue: 1.25,
      precision: 2,
    });

    const input = screen.getByLabelText('unchanged');
    fireEvent.focus(input);
    fireEvent.blur(input);

    expect(input).toHaveValue('1.25');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('supports step changes with arrow keys', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'stepped',
      initialValue: 1,
      step: 0.1,
      precision: 2,
    });

    const input = screen.getByLabelText('stepped');
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: 'ArrowUp' });

    expect(input).toHaveValue('1.10');
    expect(onChange).toHaveBeenLastCalledWith(1.1);
  });

  it('uses formatter and parser outside the editing draft', () => {
    const onChange = renderControlledNumberInput({
      'aria-label': 'formatted',
      initialValue: 1000,
      formatter: (value) => Number(value).toLocaleString('en-US'),
      parser: (value) => Number(value?.replace(/,/g, '') || 0),
      precision: 0,
    });

    const input = screen.getByLabelText('formatted');
    expect(input).toHaveValue('1,000');
    fireEvent.focus(input);
    expect(input).toHaveValue('1000');
    fireEvent.blur(input);

    expect(input).toHaveValue('1,000');
    expect(onChange).not.toHaveBeenCalled();
  });
});

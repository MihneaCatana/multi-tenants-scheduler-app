/**
 * Component render test for Spinner and FullPageSpinner.
 */
import { renderWithProviders } from '@/test-utils';
import { FullPageSpinner, Spinner } from './Spinner.tsx';

describe('Spinner', () => {
  it('renders a ProgressSpinner', () => {
    const { container } = renderWithProviders(<Spinner />);
    // PrimeReact ProgressSpinner renders an SVG
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});

describe('FullPageSpinner', () => {
  it('renders centered', () => {
    const { container } = renderWithProviders(<FullPageSpinner />);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveStyle({ display: 'flex', justifyContent: 'center', alignItems: 'center' });
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});

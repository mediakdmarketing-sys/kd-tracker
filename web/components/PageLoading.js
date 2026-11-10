import WaveLoader from '@/components/WaveLoader';

// What every page shows while its data is on the way. Each route area has a loading.js that
// re-exports this, so a click on a menu item answers at once instead of leaving the old page up.
export default function PageLoading() {
  return (
    <div className="wl-page">
      <WaveLoader />
    </div>
  );
}

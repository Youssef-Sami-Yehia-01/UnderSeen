import Sim from './ui/Sim';
import QRPage from './ui/QRPage';
import Board from './ui/Board';

export default function App() {
  const view = new URLSearchParams(location.search).get('view');
  if (view === 'qr') return <QRPage />;
  if (view === 'board') return <Board />;
  return <Sim />;
}

import { BrowserRouter, Routes, Route } from 'react-router-dom';
import ProjectsPage from './pages/ProjectsPage';
import ProjectAnalysis from './pages/ProjectAnalysis';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ProjectsPage />} />
        <Route path="/project/:projectId" element={<ProjectAnalysis />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;

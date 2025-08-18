import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ProjectsPage() {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [newRepoUrl, setNewRepoUrl] = useState('');
  const navigate = useNavigate();

  // 1. Dohvati postojeće projekte
  useEffect(() => {
    setLoading(true);
    fetch('/api/projects')
      .then(res => res.json())
      .then(data => {
        setProjects(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Greška pri dohvaćanju projekata:', err);
        setError('Greška pri dohvaćanju projekata');
        setLoading(false);
      });
  }, []);

  const handleDelete = async (projectId) => {
  try {
    const res = await fetch(`/api/projects/${projectId}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Greška pri brisanju');
    alert('Projekt obrisan.');
    // osvježi listu
    setProjects((prev) => prev.filter((p) => p._id !== projectId));
  } catch (err) {
    console.error(err);
    setError(err.message);
  }
};

  // 2. Funkcija za “add by URL”
  const handleAddByUrl = async (e) => {
    e.preventDefault();
    if (!newRepoUrl) return;

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newRepoUrl }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Greška prilikom dodavanja');
      }
      alert('Projekt dodan i analiza je pokrenuta!');

      // Dodaj u listu localno (ili ponovno fetchaj)
      setProjects(prev => [ data.project, ...prev ]);
      setNewRepoUrl('');
    } catch (err) {
      console.error(err);
      setError(err.message || 'Greška pri dodavanju');
    }
  };

const handleReanalyze = async (proj) => {
  try {
    const res = await fetch('/api/reanalyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoUrl: proj.url, projectId: proj._id }),
    });
    if (!res.ok) throw new Error('Greška pri ponovnoj analizi');
    alert(`Analiza ponovno pokrenuta za ${proj.name}`);
  } catch (err) {
    console.error(err);
    setError(err.message);
  }
};

  if (loading) return <p>Učitavanje projekata...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Projekti</h1>

      {/* Forma za “Add by URL” */}
      <form onSubmit={handleAddByUrl} style={{ marginBottom: 24 }}>
        <input
          type="text"
          placeholder="https://github.com/username/repo.git"
          value={newRepoUrl}
          onChange={(e) => setNewRepoUrl(e.target.value)}
          style={{ width: '60%', padding: 8, marginRight: 8 }}
        />
        <button type="submit">Dodaj i analiziraj</button>
      </form>

      {/* Prikaz liste */}
      {projects.length === 0 ? (
        <p>Nema dostupnih projekata.</p>
      ) : (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {projects.map(proj => (
            <li key={proj._id} className="project-card">
              <h3>{proj.name}</h3>
              <p><strong>Repo:</strong> <a href={proj.url} target="_blank" rel="noopener noreferrer">{proj.url}</a></p>
              <button onClick={() => handleReanalyze(proj)} style={{ marginRight: 8 }}>
               🔁 Ponovno pokreni analizu
              </button>
              <button onClick={() => navigate(`/project/${proj._id}`)}>
                Pogledaj analize
                </button>
              <button onClick={() => handleDelete(proj._id)}>🗑️ Obriši</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

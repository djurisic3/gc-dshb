import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';

export default function ProjectAnalysis() {
  const { projectId } = useParams();
  const [analyses, setAnalyses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch(`/api/analyses/${projectId}`)
      .then(res => res.json())
      .then(data => {
        setAnalyses(data);
        setLoading(false);
      })
      .catch(err => {
        console.error('Greška u fetchu analiza:', err);
        setError('Greška pri dohvaćanju analiza');
        setLoading(false);
      });
  }, [projectId]);

  if (loading) return <p>Učitavanje analiza...</p>;
  if (error) return <p style={{ color: 'red' }}>{error}</p>;

  return (
    <div style={{ padding: 24 }}>
      <h1>Analize projekta</h1>
      <Link to="/">← Povratak na projekte</Link>
      {analyses.length === 0 ? (
        <p>Nema analiza za ovaj projekt.</p>
      ) : (
        <ul style={{ listStyle: 'none', paddingLeft: 0 }}>
          {analyses.map(a => (
            <li key={a._id} style={{ border: '1px solid #ccc', padding: 16, marginBottom: 12 }}>
              <h3>File: {a.file}</h3>
              <p><strong>Score:</strong> {a.score}</p>
              <p><strong>Issues:</strong></p>
              <ul>
                {a.issues.map((issue, idx) => (
                  <li key={idx}>• {issue}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

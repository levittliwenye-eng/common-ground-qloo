"use client";

import { useEffect, useState } from "react";
import { DEMO_MOVIES, sampleResult } from "@/lib/common-ground.mjs";

type Movie = { entity_id: string; name: string; year?: number; disambiguation?: string };
type Result = { mode: string; status: string; poolSize: number; excludedCount: number; warnings: string[]; candidates: { movie: Movie; perPersonRanks: number[]; worstRank: number }[] };
const examplePeople: Movie[][] = [[DEMO_MOVIES[0]], [DEMO_MOVIES[1]]];

function Preferences({ index, movies, onChange, mode, locked }: { index: number; movies: Movie[]; onChange: (movies: Movie[]) => void; mode: string; locked: boolean }) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Movie[]>(mode === "sample" ? DEMO_MOVIES : []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "live" && query.trim().length < 2) { setError("Enter at least two characters."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/search?mode=${mode}&query=${encodeURIComponent(query)}`);
      const data = await response.json() as { movies: Movie[]; message?: string };
      if (!response.ok) throw new Error(data.message);
      setMatches(data.movies);
    } catch (error) { setError(error instanceof Error ? error.message : "Search could not be completed."); }
    finally { setBusy(false); }
  }

  return <section className={`person person-${index + 1}`} aria-labelledby={`person-title-${index}`}>
    <div className="person-heading"><span className="person-icon">{index + 1}</span><div><h2 id={`person-title-${index}`}>Person {index + 1}</h2><p>Choose up to 3 movies you like.</p></div></div>
    <div className="chosen" aria-label={`Selected movies for person ${index + 1}`}>
      {movies.length === 0 && <span className="muted">No preferences selected yet</span>}
      {movies.map(movie => <button className="chip" key={movie.entity_id} disabled={locked} onClick={() => onChange(movies.filter(item => item.entity_id !== movie.entity_id))} aria-label={`Remove ${movie.name}`}>{movie.name}<span aria-hidden="true">×</span></button>)}
    </div>
    <form className="search-form" onSubmit={search}>
      <label htmlFor={`search-${index}`}>Find a movie title</label>
      <div className="search-row"><input id={`search-${index}`} value={query} onChange={event => setQuery(event.target.value)} disabled={busy || locked} maxLength={100} placeholder={mode === "sample" ? "Search the sample titles" : "Enter a full movie title"} /><button disabled={busy || locked} className="secondary" type="submit">{busy ? "Searching…" : "Search"}</button></div>
    </form>
    <div className="matches" aria-label={`Movie matches for person ${index + 1}`}>
      {matches.filter(movie => !movies.some(item => item.entity_id === movie.entity_id)).map(movie => <button className="movie-option" key={movie.entity_id} disabled={locked || movies.length >= 3} onClick={() => onChange([...movies, movie])}><span>{movie.name}{movie.year && <small> · {movie.year}</small>}{movie.disambiguation && <small className="disambiguation">{movie.disambiguation}</small>}</span><span className="add" aria-hidden="true">+</span></button>)}
      {!matches.length && !busy && <p className="muted">{mode === "sample" ? "No matching sample titles." : "Search, then select the exact movie you mean."}</p>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

export default function Home() {
  const [mode, setMode] = useState("sample");
  const [liveConfigured, setLiveConfigured] = useState(false);
  const [people, setPeople] = useState<Movie[][]>(examplePeople);
  const [result, setResult] = useState<Result | null>(sampleResult(examplePeople.map(person => person.map(movie => movie.entity_id))) as Result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/status").then(response => response.json()).then(data => setLiveConfigured((data as { liveConfigured?: boolean }).liveConfigured === true)).catch(() => {});
  }, []);

  function changeMode(next: string) {
    setMode(next); setError("");
    setPeople(next === "sample" ? examplePeople : [[], []]);
    setResult(next === "sample" ? sampleResult(examplePeople.map(person => person.map(movie => movie.entity_id))) as Result : null);
  }

  async function recommend() {
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/recommend", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode, people: people.map(person => person.map(movie => movie.entity_id)) }) });
      const data = await response.json() as Result & { message?: string };
      if (!response.ok) throw new Error(data.message);
      setResult(data);
    } catch (error) { setError(error instanceof Error ? error.message : "The recommendations could not be completed."); }
    finally { setBusy(false); }
  }

  return <main>
    <header className="masthead"><span className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /></span>Common Ground</span><span className="masthead-note">Movie night for two</span></header>
    <div className="workspace">
      <div className="intro"><div><span className="eyebrow">MAKE ROOM FOR BOTH TASTES</span><h1>A movie you can agree on.</h1><p>Start with films each person likes. Find new choices that rank well for both.</p></div><div className="mode-control" aria-label="Data mode"><button aria-pressed={mode === "sample"} onClick={() => changeMode("sample")} disabled={busy}>Sample</button><button aria-pressed={mode === "live"} onClick={() => changeMode("live")} disabled={busy || !liveConfigured}>Live Qloo</button></div></div>
      {mode === "sample" && <div className="sample-note"><strong>Sample walkthrough</strong><span>The titles and rankings below are illustrative. They are not live Qloo recommendations.{!liveConfigured && " Live access is awaiting a Qloo key."}</span></div>}
      <div className="people-grid">
        {people.map((movies, index) => <Preferences key={`${mode}-${index}`} index={index} mode={mode} locked={busy} movies={movies} onChange={updated => { setPeople(previous => previous.map((person, i) => i === index ? updated : person)); setResult(null); setError(""); }} />)}
      </div>
      <div className="action-row"><p>Preference films are left out of the results.</p><button className="primary" onClick={recommend} disabled={busy || people.some(person => !person.length)}>{busy ? "Finding shared picks…" : "Find shared picks"}</button></div>
      {error && <p className="error page-error" role="alert">{error}</p>}
      <section className="results" aria-labelledby="results-title" aria-live="polite" aria-busy={busy}>
        <div className="results-heading"><h2 id="results-title">Shared picks</h2>{result?.poolSize ? <span>{result.poolSize} movies ranked for both people</span> : null}</div>
        {busy && <div className="empty-result">Comparing the same candidate movies for each person…</div>}
        {!busy && !result && <div className="empty-result">Choose preferences for both people, then find your shared picks.</div>}
        {result && !result.candidates.length && <div className="empty-result">There is not enough shared ranking data for a recommendation. Try different preference movies.</div>}
        {result && result.candidates.length > 0 && <div className="picks-grid">{result.candidates.map((candidate, index) => <article className={`pick ${index === 0 ? "best-pick" : ""}`} key={candidate.movie.entity_id}>
          <div className="pick-top"><span className="pick-number">0{index + 1}</span>{index === 0 && <span className="best-label">Best balance</span>}</div>
          <h3>{candidate.movie.name}</h3>{candidate.movie.year && <p className="year">{candidate.movie.year}</p>}
          <div className="rank-list">{candidate.perPersonRanks.map((rank, person) => <div className="rank-row" key={person}><span>Person {person + 1}</span><strong>#{rank}<small> of {result.poolSize}</small></strong></div>)}</div>
        </article>)}</div>}
        {result?.warnings.filter(warning => mode !== "sample" || !warning.startsWith("Illustrative")).map(warning => <p className="result-note" key={warning}>{warning}</p>)}
        <details className="method"><summary>How the balance works</summary><p>Each person ranks the same candidate pool. We prefer the movie with the better worst rank; ties use the average rank. Both people must have ranking data for a movie. These are relative positions within this pool, not probabilities or a prediction of enjoyment.</p><p>Live mode draws candidates from each person’s Qloo recommendations, then re-ranks the combined pool for each person. It does not check streaming availability or make bookings.</p></details>
      </section>
      <footer>Preferences stay in memory. Live requests send selected movie IDs to Qloo.</footer>
    </div>
  </main>;
}

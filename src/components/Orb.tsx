export function Orb({ small = false }: { small?: boolean }) {
  return (
    <div className={`orb ${small ? "orb-small" : ""}`} aria-hidden="true">
      <div className="orb-halo" />
      <div className="orb-core">
        <div className="orb-band band-one" />
        <div className="orb-band band-two" />
        <div className="orb-band band-three" />
        <div className="orb-shine" />
      </div>
      <span className="orb-spark spark-one" />
      <span className="orb-spark spark-two" />
    </div>
  );
}
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className="brand">
      <img src="/zyra.svg" alt="" width="34" height="34" />
      {!compact && (
        <>
          <span>
            ZYRA<span className="brand-ai">AI</span>
          </span>
        </>
      )}
    </span>
  );
}

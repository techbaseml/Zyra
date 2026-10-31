import { useEffect, useRef, useState } from "react";
type TurnstileAPI = {
  render: (element: HTMLElement, options: Record<string, unknown>) => string;
  remove: (id: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileAPI;
  }
}
let loader: Promise<void> | undefined;
function load() {
  if (window.turnstile) return Promise.resolve();
  return (loader ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loader = undefined;
      reject(new Error("Security check could not load."));
    };
    document.head.appendChild(s);
  }));
}
export default function Turnstile({
  siteKey,
  action,
  onToken,
}: {
  siteKey: string;
  action: string;
  onToken: (token: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null),
    callback = useRef(onToken);
  callback.current = onToken;
  const [error, setError] = useState("");
  useEffect(() => {
    if (!siteKey) return;
    let active = true,
      id: string | undefined;
    load()
      .then(() => {
        if (active && ref.current)
          id = window.turnstile!.render(ref.current, {
            sitekey: siteKey,
            action,
            theme: "auto",
            callback: (token: string) => callback.current(token),
            "expired-callback": () => callback.current(""),
            "error-callback": () => {
              callback.current("");
              setError(
                "Security check failed. Close this dialog and try again.",
              );
            },
          });
      })
      .catch(() =>
        setError("The security check could not load. Check your connection."),
      );
    return () => {
      active = false;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, action]);
  return (
    <>
      <div ref={ref} />
      {error && <p className="form-error">{error}</p>}
    </>
  );
}

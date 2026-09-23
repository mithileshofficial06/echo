"use client";

import { useEffect } from "react";

export default function ClientGame() {
  useEffect(() => {
    void import("./main");
  }, []);

  return (
    <main id="app">
      <canvas id="game" />
      <div id="ui" />
    </main>
  );
}
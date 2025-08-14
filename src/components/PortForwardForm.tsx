import React from 'react';

export default function PortForwardForm() {
  return (
    <form style={{ display: 'flex', gap: 8 }} onSubmit={(e) => e.preventDefault()}>
      <input placeholder="Local port" />
      <input placeholder="Remote host" />
      <input placeholder="Remote port" />
      <button type="submit">Open Tunnel</button>
    </form>
  );
}


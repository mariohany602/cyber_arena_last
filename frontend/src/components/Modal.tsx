import React from "react";

export default function Modal({ open, onClose, children }: { open: boolean; onClose: ()=>void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white dark:bg-[#071221] rounded-lg p-6 max-w-xl w-full">
        <button onClick={onClose} className="mb-4 text-sm">Close</button>
        {children}
      </div>
    </div>
  );
}

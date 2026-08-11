import { useEffect, useRef, type ReactNode } from "react";

export function Modal({ labelledBy, onClose, children }: { labelledBy: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
    return () => ref.current?.close();
  }, []);
  return <dialog ref={ref} aria-labelledby={labelledBy} onClose={onClose} onClick={(event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  }} className="backdrop:bg-black/50 p-0 w-[calc(100%_-_3rem)] max-w-5xl max-h-[85vh]">{children}</dialog>;
}

'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { X, ZoomIn } from 'lucide-react';

export function ZoomableImage({ src, alt }: { src: string; alt?: string }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="relative group cursor-pointer" onClick={() => setOpen(true)}>
      <img
          src={src}
          alt={alt || '教材配图'}
          className="w-full rounded-lg border border-gray-100 dark:border-gray-700 transition-shadow group-hover:shadow-lg"
        />
        <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 rounded-lg transition-colors">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-white/90 rounded-full p-2 shadow-md">
            <ZoomIn className="w-4 h-4 text-gray-700" />
          </div>
        </div>
      </div>

      {open && createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md cursor-zoom-out"
            onClick={() => setOpen(false)}
          >
            <motion.img
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.25, ease: 'easeOut' }}
              src={src}
              alt={alt || '教材配图'}
              className="max-w-[92vw] max-h-[92vh] object-contain rounded-lg shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              onClick={() => setOpen(false)}
              className="absolute top-6 right-6 w-10 h-10 rounded-full bg-white/90 shadow-lg flex items-center justify-center hover:bg-white transition-colors"
            >
              <X className="w-5 h-5 text-gray-800" />
            </button>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

/**
 * Compress an image file client-side before uploading.
 * Uses canvas to resize and convert to WebP (fallback JPEG).
 *
 * @param file Original image file
 * @param maxWidth Max width in pixels (default 1200)
 * @param quality Quality 0-1 (default 0.82)
 * @returns Compressed File object
 */
export async function compressImage(
  file: File,
  maxWidth = 1200,
  quality = 0.82,
): Promise<File> {
  // Skip non-image files
  if (!file.type.startsWith('image/')) return file;

  // Skip if already small (< 150KB)
  if (file.size < 150 * 1024) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      // Calculate new dimensions
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }

      // Draw to canvas
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first
      tryFormat(canvas, 'image/webp', quality, file)
        .then((result) => {
          if (result && result.size < file.size) {
            resolve(result);
          } else {
            // Fallback to JPEG
            tryFormat(canvas, 'image/jpeg', quality, file)
              .then((jpegResult) => {
                if (jpegResult && jpegResult.size < file.size) {
                  resolve(jpegResult);
                } else {
                  // If still too big, try lower quality
                  tryFormat(canvas, 'image/jpeg', 0.6, file)
                    .then((lowResult) => resolve(lowResult || file));
                }
              });
          }
        });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file); // Fallback to original
    };

    img.src = url;
  });
}

function tryFormat(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number,
  original: File,
): Promise<File | null> {
  return new Promise((resolve) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }

        const ext = format === 'image/webp' ? 'webp' : 'jpg';
        const originalName = original.name.replace(/\.[^.]+$/, '');
        const newFile = new File([blob], `${originalName}.${ext}`, {
          type: format,
          lastModified: Date.now(),
        });

        console.log(
          `[Compress] ${format.split('/')[1].toUpperCase()}: ${(original.size / 1024).toFixed(0)}KB → ${(newFile.size / 1024).toFixed(0)}KB (${Math.round((1 - newFile.size / original.size) * 100)}% reducción)`,
        );

        resolve(newFile);
      },
      format,
      quality,
    );
  });
}

/**
 * Compress multiple image files.
 */
export async function compressImages(files: File[], maxWidth = 1200, quality = 0.82): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f, maxWidth, quality)));
}

/**
 * Compress an image file client-side before uploading.
 * Uses canvas to resize and convert to WebP.
 *
 * @param file Original image file
 * @param maxWidth Max width in pixels (default 1200)
 * @param quality WebP quality 0-1 (default 0.82)
 * @returns Compressed File object (WebP format)
 */
export async function compressImage(
  file: File,
  maxWidth = 1200,
  quality = 0.82,
): Promise<File> {
  // Skip if already small (< 200KB)
  if (file.size < 200 * 1024) return file;

  // Skip non-image files
  if (!file.type.startsWith('image/')) return file;

  return new Promise((resolve, reject) => {
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
        resolve(file); // Fallback to original
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);

      // Try WebP first, fallback to JPEG
      const format = 'image/webp';
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }

          // Build new filename with .webp extension
          const originalName = file.name.replace(/\.[^.]+$/, '');
          const newFile = new File([blob], `${originalName}.webp`, {
            type: format,
            lastModified: Date.now(),
          });

          console.log(
            `Image compressed: ${(file.size / 1024).toFixed(0)}KB → ${(newFile.size / 1024).toFixed(0)}KB (${Math.round((1 - newFile.size / file.size) * 100)}% reduction)`,
          );

          resolve(newFile);
        },
        format,
        quality,
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Error loading image for compression'));
    };

    img.src = url;
  });
}

/**
 * Compress multiple image files.
 */
export async function compressImages(files: File[], maxWidth = 1200, quality = 0.82): Promise<File[]> {
  return Promise.all(files.map((f) => compressImage(f, maxWidth, quality)));
}

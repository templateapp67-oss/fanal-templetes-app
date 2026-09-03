export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB limit for input
export const TARGET_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB target max limit

export interface FileValidationResult {
  isValid: boolean;
  errorMessage?: string;
  dataUrl?: string;
}

export interface CompressionResult {
  isValid: boolean;
  errorMessage?: string;
  dataUrl?: string;
  fileName: string;
  fileType: string;
  originalSizeKb: number;
  compressedSizeKb: number;
  width: number;
  height: number;
  compressionRatio: number;
}

/**
 * Validates file size and converts file to Base64 / Data URL string
 */
export async function validateAndReadImageFile(file: File): Promise<FileValidationResult> {
  if (!file) {
    return { isValid: false, errorMessage: 'No file selected.' };
  }

  // Check file type
  if (!file.type.startsWith('image/')) {
    return { isValid: false, errorMessage: 'Please select a valid image file (PNG, JPG, WEBP, SVG).' };
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result) {
        resolve({ isValid: true, dataUrl: result });
      } else {
        resolve({ isValid: false, errorMessage: 'Failed to process image file.' });
      }
    };
    reader.onerror = () => {
      resolve({ isValid: false, errorMessage: 'An error occurred while reading the file.' });
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Automatically resizes and compresses an image to be <= 2MB using HTML5 Canvas API
 * maintains aspect ratio and scales quality/resolution iteratively.
 */
export async function compressAndResizeImage(
  file: File,
  maxDimension: number = 1600, // Maximum width or height
  targetMaxSizeBytes: number = 2 * 1024 * 1024 // 2 MB limit
): Promise<CompressionResult> {
  if (!file) {
    return { 
      isValid: false, 
      errorMessage: 'No file selected.', 
      fileName: '', 
      fileType: '', 
      originalSizeKb: 0, 
      compressedSizeKb: 0, 
      width: 0, 
      height: 0, 
      compressionRatio: 0 
    };
  }

  if (!file.type.startsWith('image/')) {
    return { 
      isValid: false, 
      errorMessage: 'Please select a valid image file (PNG, JPG, WEBP).', 
      fileName: file.name, 
      fileType: file.type, 
      originalSizeKb: 0, 
      compressedSizeKb: 0, 
      width: 0, 
      height: 0, 
      compressionRatio: 0 
    };
  }

  const originalSizeKb = Math.round((file.size / 1024) * 100) / 100;

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        // Auto-scale maintaining aspect ratio
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve({
            isValid: false,
            errorMessage: 'Could not create canvas 2D context.',
            fileName: file.name,
            fileType: file.type,
            originalSizeKb,
            compressedSizeKb: originalSizeKb,
            width: img.width,
            height: img.height,
            compressionRatio: 0
          });
          return;
        }

        // Draw image onto canvas
        ctx.drawImage(img, 0, 0, width, height);

        // Iterative quality reduction to meet 2MB threshold
        let quality = 0.90;
        let dataUrl = '';
        let compressedSizeKb = 0;
        let scaleFactor = 1.0;

        // Try jpeg compression first, fallback to png if transparent (or just jpeg/webp for max compression)
        const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';

        const runCompression = () => {
          let currentWidth = Math.round(width * scaleFactor);
          let currentHeight = Math.round(height * scaleFactor);

          const compressCanvas = document.createElement('canvas');
          compressCanvas.width = currentWidth;
          compressCanvas.height = currentHeight;
          const compressCtx = compressCanvas.getContext('2d');
          
          if (compressCtx) {
            compressCtx.drawImage(canvas, 0, 0, currentWidth, currentHeight);
            if (outputType === 'image/jpeg') {
              dataUrl = compressCanvas.toDataURL('image/jpeg', quality);
            } else {
              dataUrl = compressCanvas.toDataURL('image/png');
            }
          } else {
            dataUrl = canvas.toDataURL(outputType, outputType === 'image/jpeg' ? quality : undefined);
          }

          // Calculate payload size of Base64 string
          const parts = dataUrl.split(',');
          const base64Length = parts[1] ? parts[1].length : 0;
          compressedSizeKb = Math.round(((base64Length * 0.75) / 1024) * 100) / 100;
        };

        // First compression pass
        runCompression();

        // If compressed image still exceeds the threshold, iteratively downscale resolution or quality
        while (compressedSizeKb * 1024 > targetMaxSizeBytes && (quality > 0.2 || scaleFactor > 0.4)) {
          if (outputType === 'image/jpeg') {
            quality -= 0.15;
            if (quality < 0.3) {
              quality = 0.7; // reset quality but downscale dimensions
              scaleFactor *= 0.75;
            }
          } else {
            // PNG only shrinks by reducing resolution
            scaleFactor *= 0.70;
          }
          runCompression();
        }

        const compressionRatio = Math.round((1 - (compressedSizeKb / originalSizeKb)) * 100);

        resolve({
          isValid: true,
          dataUrl,
          fileName: file.name,
          fileType: outputType,
          originalSizeKb,
          compressedSizeKb,
          width: Math.round(width * scaleFactor),
          height: Math.round(height * scaleFactor),
          compressionRatio: Math.max(0, compressionRatio)
        });
      };

      img.onerror = () => {
        resolve({
          isValid: false,
          errorMessage: 'Failed to parse image data.',
          fileName: file.name,
          fileType: file.type,
          originalSizeKb,
          compressedSizeKb: 0,
          width: 0,
          height: 0,
          compressionRatio: 0
        });
      };

      img.src = event.target?.result as string;
    };

    reader.onerror = () => {
      resolve({
        isValid: false,
        errorMessage: 'Failed to read image file.',
        fileName: file.name,
        fileType: file.type,
        originalSizeKb,
        compressedSizeKb: 0,
        width: 0,
        height: 0,
        compressionRatio: 0
      });
    };

    reader.readAsDataURL(file);
  });
}

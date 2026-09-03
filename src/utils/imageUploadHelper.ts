export const MAX_IMAGE_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

export interface FileValidationResult {
  isValid: boolean;
  errorMessage?: string;
  dataUrl?: string;
}

/**
 * Validates file size (max 5MB) and converts file to Base64 / Data URL string
 */
export async function validateAndReadImageFile(file: File): Promise<FileValidationResult> {
  if (!file) {
    return { isValid: false, errorMessage: 'No file selected.' };
  }

  // Check file type
  if (!file.type.startsWith('image/')) {
    return { isValid: false, errorMessage: 'Please select a valid image file (PNG, JPG, WEBP, SVG).' };
  }

  // Check file size limit (5MB)
  if (file.size > MAX_IMAGE_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    return { 
      isValid: false, 
      errorMessage: `File size (${sizeMb}MB) exceeds the 5MB limit. Please upload a smaller image file.` 
    };
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

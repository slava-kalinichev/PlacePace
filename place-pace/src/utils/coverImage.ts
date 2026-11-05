// Сжатие обложки маршрута перед отправкой на сервер

// Максимальный размер исходного файла обложки
export const COVER_MAX_FILE_BYTES = 10 * 1024 * 1024;

const COVER_MAX_SIDE = 1000;
const COVER_JPEG_QUALITY = 0.82;

const readAsDataURL = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const loadImage = (file: Blob): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось прочитать изображение'));
    };
    img.src = url;
  });

// Data URL JPEG с ограничением длинной стороны (если не удалось декодировать - исходный файл)
export const prepareCoverImage = async (file: File): Promise<string> => {
  try {
    const img = await loadImage(file);
    const scale = Math.min(1, COVER_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return readAsDataURL(file);

    // Белая подложка - JPEG без альфа-канала, прозрачный PNG иначе станет чёрным
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = canvas.toDataURL('image/jpeg', COVER_JPEG_QUALITY);
    // Если сжатие увеличило размер, оставляем исходный файл
    if (file.size * 1.37 < compressed.length) return readAsDataURL(file);
    return compressed;
  } catch {
    return readAsDataURL(file);
  }
};

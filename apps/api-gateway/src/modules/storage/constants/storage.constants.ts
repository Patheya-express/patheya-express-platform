export const STORAGE_PROVIDER = 'STORAGE_PROVIDER';

/** Only two supported drivers — local for development, Cloudinary for production. */
export enum StorageDriver {
  LOCAL = 'local',
  CLOUDINARY = 'cloudinary',
}

/** Root namespace every Cloudinary asset is uploaded under, ahead of the caller-supplied
 *  `folder` (e.g. `restaurants/logos`, `delivery-partners/documents`) — keeps every environment
 *  sharing one Cloudinary account cleanly separated from other unrelated projects/assets. */
export const CLOUDINARY_ROOT_FOLDER = 'patheya-express';

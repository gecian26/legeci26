import { storage } from "./firebase-config.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";
import { getSession } from "./auth.js";

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateImageFile(file) {
  if (!file) return "No file selected.";
  if (!ALLOWED_TYPES.includes(file.type)) return "Only JPEG, PNG, WebP, or GIF images are allowed.";
  if (file.size > MAX_SIZE) return "Image must be smaller than 5 MB.";
  return null;
}

export async function uploadImage(storagePath, file) {
  const session = getSession();
  if (!session) throw new Error("NO_SESSION");

  const error = validateImageFile(file);
  if (error) throw new Error(error);

  const storageRef = ref(storage, storagePath);
  await uploadBytes(storageRef, file, {
    contentType: file.type,
    customMetadata: { sessionId: session.sessionId },
  });

  const url = await getDownloadURL(storageRef);
  return { url, path: storagePath };
}

export async function deleteImage(storagePath) {
  if (!storagePath) return;
  try {
    await deleteObject(ref(storage, storagePath));
  } catch {
    // File may already be removed
  }
}

export async function uploadImages(basePath, files) {
  const results = [];
  for (const file of files) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${basePath}/${Date.now()}_${safeName}`;
    results.push(await uploadImage(path, file));
  }
  return results;
}

export const APP_NAME = 'OpenFirst';
export const APP_DOMAIN = 'openfirst.io';

export const PACKAGE_SCHEMA = 'lifepackage/v1';
export const LEGACY_PACKAGE_SCHEMA = 'inheritance-package/v1';
export const PACKAGE_SCHEMAS = [PACKAGE_SCHEMA, LEGACY_PACKAGE_SCHEMA];

export const SOURCE_FILE = 'lifepackage.json';
export const LEGACY_SOURCE_FILE = 'inheritance.json';
export const SOURCE_FILES = [SOURCE_FILE, LEGACY_SOURCE_FILE];

export const ENCRYPTED_FORMAT = 'lifepackage-encrypted/v1';
export const LEGACY_ENCRYPTED_FORMAT = 'inheritance-encrypted/v1';
export const ENCRYPTED_FORMATS = [ENCRYPTED_FORMAT, LEGACY_ENCRYPTED_FORMAT];

export function isPackageSchema(schema) {
  return PACKAGE_SCHEMAS.includes(schema);
}

export function isSourceFile(path) {
  const name = String(path || '').split('/').pop()?.toLowerCase();
  return SOURCE_FILES.includes(name);
}

export function sourceFileRank(path) {
  const name = String(path || '').split('/').pop()?.toLowerCase();
  const idx = SOURCE_FILES.indexOf(name);
  return idx === -1 ? SOURCE_FILES.length : idx;
}

export function sourceBase(path) {
  const file = String(path || '').split('/').pop();
  return file && SOURCE_FILES.includes(file.toLowerCase())
    ? String(path).slice(0, -file.length)
    : '';
}

export function normalizePackageFormat(data) {
  if (data && typeof data === 'object' && data.schema === LEGACY_PACKAGE_SCHEMA) {
    data.schema = PACKAGE_SCHEMA;
  }
  return data;
}

export function packageForExport(data) {
  return data && typeof data === 'object' ? { ...data, schema: PACKAGE_SCHEMA } : data;
}

import { validateAndMapProductFactSetRow, validateAndMapProductRow } from './product-mappers.js';
import {
  validateAndMapAffiliateDestinationRow,
  validateAndMapProductFactRow,
} from './item-mappers.js';

export {
  validateAndMapProductRow,
  validateAndMapProductFactSetRow,
  validateAndMapProductFactRow,
  validateAndMapAffiliateDestinationRow,
};

export const mapProductRow = validateAndMapProductRow;
export const mapProductFactSetRow = validateAndMapProductFactSetRow;
export const mapProductFactRow = validateAndMapProductFactRow;
export const mapAffiliateDestinationRow = validateAndMapAffiliateDestinationRow;

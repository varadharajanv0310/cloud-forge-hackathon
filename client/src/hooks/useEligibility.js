import { useMemo } from 'react';
import { getEligibleSchemes } from '../utils/eligibilityEngine.js';
import { useSchemes } from '../utils/schemesStore.js';

/**
 * Runs the eligibility pipeline over the schemes this citizen can actually
 * claim — central plus their own state — fetched as JSON shards rather than
 * bundled into the app.
 *
 * Shape change from v1: `totalValue` / `totalEstimatedValue` are gone. They were
 * one summed rupee figure that mixed grants, loan ceilings and one-time
 * payments and substituted Rs 50,000 for any scheme whose amount could not be
 * parsed. Callers now read `totals` — see computeTotals() in eligibilityEngine.
 *
 * Returns:
 *   confirmed      [{scheme, score}] sorted by fit
 *   fuzzy          [{scheme, fuzzy, score}] near misses (max 6)
 *   totals         money breakdown; kinds are never summed together
 *   topCategory    most common category among confirmed
 *   totalCount     confirmed.length
 *   loading        shards still in flight
 *   eligible / close_matches   legacy aliases
 */
export const useEligibility = (vault) => {
  const { schemes, loading, error } = useSchemes(vault?.state);

  const result = useMemo(() => {
    if (!vault || !schemes || schemes.length === 0) {
      return getEligibleSchemes([], null);
    }
    return getEligibleSchemes(schemes, vault);
  }, [vault, schemes]);

  const { confirmed, fuzzy, totals, topCategory } = result;

  return {
    confirmed,
    fuzzy,
    totals,
    topCategory,
    totalCount: confirmed.length,
    loading,
    error,
    // Legacy aliases still read by SahayakMode and CrossSchemeChain.
    eligible: confirmed,
    close_matches: fuzzy,
  };
};

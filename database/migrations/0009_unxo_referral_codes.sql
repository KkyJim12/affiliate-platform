UPDATE users
SET referral_code = 'UNXO-' || SUBSTRING(referral_code FROM 6)
WHERE referral_code LIKE 'LOOP-%';

-- =====================================================================
-- LOGOS dos cartões — preenche image_url com o logo de cada emissor.
-- Usa o serviço de favicons do Google (estável, gratuito): retorna o
-- símbolo/logo do banco em 128px. Rode no Console do D1 (produção).
-- Idempotente: pode rodar quantas vezes quiser.
-- Para trocar por uma imagem melhor depois, é só editar o cartão no admin.
-- =====================================================================
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=nubank.com.br&sz=128'      WHERE slug='nubank';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=nubank.com.br&sz=128'      WHERE slug='nubank-ultravioleta';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=inter.co&sz=128'           WHERE slug='inter-gold';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=c6bank.com.br&sz=128'      WHERE slug='c6-bank';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=xpi.com.br&sz=128'         WHERE slug='xp-visa-infinite';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=santander.com.br&sz=128'   WHERE slug='santander-unique';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=santander.com.br&sz=128'   WHERE slug='santander-sx';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=itau.com.br&sz=128'        WHERE slug='itau-click-platinum';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=itau.com.br&sz=128'        WHERE slug='latam-pass-itau';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=amazon.com.br&sz=128'      WHERE slug='bradesco-amazon';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=picpay.com&sz=128'         WHERE slug='picpay';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=pagbank.com.br&sz=128'     WHERE slug='pagbank';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=mercadopago.com.br&sz=128' WHERE slug='mercado-pago';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=willbank.com.br&sz=128'    WHERE slug='will-bank';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=neon.com.br&sz=128'        WHERE slug='neon';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=digio.com.br&sz=128'       WHERE slug='digio';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=magazineluiza.com.br&sz=128' WHERE slug='magalu';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=bb.com.br&sz=128'          WHERE slug='ourocard-bb';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=americanexpress.com&sz=128' WHERE slug='amex-platinum';
UPDATE credit_cards SET image_url='https://www.google.com/s2/favicons?domain=voeazul.com.br&sz=128'     WHERE slug='azul-itaucard-infinite';

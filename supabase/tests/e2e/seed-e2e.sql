-- Dados extras para o teste no navegador: bairros e pedidos com coordenadas
-- (Centro de São Paulo), já prontos para despacho.
insert into delivery_zones (company_id, name, fee, eta_minutes) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Centro', 5, 20),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Bela Vista', 7, 25);
insert into orders (company_id, customer_name, customer_phone, address_street, address_number, address_neighborhood, address_city, lat, lng, subtotal, payment_method, status) values
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Ana Souza', '11911112222', 'Rua Direita', '100', 'Centro', 'São Paulo', -23.5489, -46.6350, 42, 'pix', 'ready'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Bruno Lima', '11933334444', 'Rua Treze de Maio', '500', 'Bela Vista', 'São Paulo', -23.5605, -46.6460, 31.5, 'dinheiro', 'ready'),
  ('aaaaaaaa-0000-0000-0000-000000000000', 'Carla Dias', '11955556666', 'Rua XV de Novembro', '200', 'Centro', 'São Paulo', -23.5460, -46.6340, 25, 'cartao', 'preparing');
update profiles set last_lat = -23.5505, last_lng = -46.6333, last_location_at = now() where id = '00000000-0000-0000-0000-0000000000c1';

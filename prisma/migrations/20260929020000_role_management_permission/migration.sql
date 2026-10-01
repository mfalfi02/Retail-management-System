INSERT INTO `Permission` (`id`, `key`, `description`)
VALUES (UUID(), 'role.manage', 'Manage role permission assignments')
ON DUPLICATE KEY UPDATE `description` = VALUES(`description`);

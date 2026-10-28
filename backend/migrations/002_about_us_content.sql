CREATE TABLE IF NOT EXISTS site_content (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  page_key VARCHAR(80) NOT NULL,
  page_title VARCHAR(160) NOT NULL DEFAULT 'About EventHub',
  content JSON NULL,
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_site_content_page (page_key, language)
) ENGINE=InnoDB;

INSERT INTO site_content (page_key, page_title, content, is_published, language)
VALUES (
  'about_us',
  'About EventHub',
  '{
    "page_title": "About EventHub",
    "hero_heading": "About EventHub",
    "hero_subtitle": "Your trusted platform for planning and organizing memorable events.",
    "introduction": "EventHub helps organizers and customers discover event services, compare categories, request quotations, and coordinate bookings in one place.",
    "mission": "Simplify event planning by connecting customers with the right service categories and vendors.",
    "vision": "Make event-service discovery more accessible, better organized, and easier to trust.",
    "values": [
      {"title": "Trust and Transparency", "description": "Clear service information and direct coordination."},
      {"title": "Quality Service", "description": "Relevant providers and practical package discovery."},
      {"title": "Customer Satisfaction", "description": "A better journey from discovery to booking."}
    ],
    "benefits": [
      {"title": "Easier vendor discovery", "description": "Browse relevant vendors by service type and location."},
      {"title": "Convenient quotation requests", "description": "Ask for a quote and manage the next steps through the platform."}
    ],
    "steps": [
      {"title": "Explore categories", "description": "Browse categories and services."},
      {"title": "Find vendors", "description": "Compare the right providers."},
      {"title": "Request a quotation", "description": "Share your event requirements."}
    ],
    "language": "en",
    "is_published": true
  }',
  TRUE,
  'en'
)
ON DUPLICATE KEY UPDATE
  page_title = VALUES(page_title),
  content = VALUES(content),
  is_published = VALUES(is_published),
  language = VALUES(language);

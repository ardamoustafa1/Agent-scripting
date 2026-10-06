package io.verbis.avaya.sidecar.aacc;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

/** Minimal, hardened SOAP/XML helpers (no DTDs, no external entities — XXE-safe). */
public final class SoapXml {
  private SoapXml() {}

  public static Document parse(String xml) {
    try {
      var factory = DocumentBuilderFactory.newInstance();
      factory.setNamespaceAware(true);
      factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
      factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
      factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
      factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
      factory.setXIncludeAware(false);
      factory.setExpandEntityReferences(false);
      return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    } catch (Exception e) {
      throw new IllegalArgumentException("invalid XML", e);
    }
  }

  /** First descendant with this local name (namespace-agnostic), or null. */
  public static Element first(Node root, String localName) {
    List<Element> all = all(root, localName);
    return all.isEmpty() ? null : all.get(0);
  }

  public static List<Element> all(Node root, String localName) {
    List<Element> out = new ArrayList<>();
    collect(root, localName, out);
    return out;
  }

  private static void collect(Node node, String localName, List<Element> out) {
    for (Node child = node.getFirstChild(); child != null; child = child.getNextSibling()) {
      if (child instanceof Element element) {
        String name = element.getLocalName() != null ? element.getLocalName() : element.getTagName();
        if (localName.equals(name)) out.add(element);
        collect(element, localName, out);
      }
    }
  }

  public static String text(Node root, String localName) {
    Element element = first(root, localName);
    if (element == null) return null;
    String value = element.getTextContent();
    return value == null ? null : value.trim();
  }

  public static String escape(String value) {
    return value == null ? "" : value.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;").replace("'", "&apos;");
  }

  public static String envelope(String namespace, String body) {
    return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><soapenv:Envelope xmlns:soapenv=\"http://schemas.xmlsoap.org/soap/envelope/\" xmlns:ws=\""
        + escape(namespace) + "\"><soapenv:Body>" + body + "</soapenv:Body></soapenv:Envelope>";
  }
}

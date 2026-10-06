package io.verbis.engage.sidecar.cti.psdk;

import com.genesyslab.platform.applicationblocks.com.ConfServiceFactory;
import com.genesyslab.platform.applicationblocks.com.IConfService;
import com.genesyslab.platform.applicationblocks.com.objects.CfgAgentLogin;
import com.genesyslab.platform.applicationblocks.com.objects.CfgPerson;
import com.genesyslab.platform.applicationblocks.com.queries.CfgAgentLoginQuery;
import com.genesyslab.platform.applicationblocks.com.queries.CfgPersonQuery;
import com.genesyslab.platform.commons.protocol.Endpoint;
import com.genesyslab.platform.configuration.protocol.ConfServerProtocol;
import com.genesyslab.platform.configuration.protocol.types.CfgAppType;
import io.verbis.engage.sidecar.config.SidecarProperties;
import io.verbis.engage.sidecar.envelope.EngageAgent;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Agent identity from Config Server: DN → agent login (from EventAgentLogin) → CfgAgentLogin →
 * CfgPerson (employeeId, userName). Results are cached; the Config Server password is read from a
 * mounted secret file, never from env or logs.
 */
final class ConfigDirectory implements AutoCloseable {
  private final SidecarProperties.Psdk psdk;
  private final Map<String, String> loginOnDn = new ConcurrentHashMap<>();
  private final Map<String, EngageAgent> byLogin = new ConcurrentHashMap<>();
  private final Map<String, EngageAgent> byEmployee = new ConcurrentHashMap<>();
  private ConfServerProtocol protocol;
  private IConfService service;

  ConfigDirectory(SidecarProperties.Psdk psdk) {
    this.psdk = psdk;
  }

  void open() throws Exception {
    var cs = psdk.configServer();
    protocol = new ConfServerProtocol(new Endpoint("ConfServer", cs.host(), cs.port()));
    protocol.setClientName(psdk.applicationName());
    protocol.setClientApplicationType(CfgAppType.CFGThirdPartyServer.ordinal());
    protocol.setUserName(cs.user());
    protocol.setUserPassword(Files.readString(Path.of(cs.passwordFile())).trim());
    protocol.open();
    service = ConfServiceFactory.createConfService(protocol);
  }

  void rememberLogin(String dn, String agentLogin) {
    if (dn != null && agentLogin != null) loginOnDn.put(dn, agentLogin);
  }

  void forgetLogin(String dn) {
    if (dn != null) loginOnDn.remove(dn);
  }

  EngageAgent agentOnDn(String dn) {
    if (dn == null) return null;
    String login = loginOnDn.get(dn);
    if (login == null) return null;
    EngageAgent known = byLogin.computeIfAbsent(login, this::lookupLogin);
    return known == null ? null : new EngageAgent(known.employeeId(), known.userName(), login, dn, known.place());
  }

  /** Interaction Server reports the person's employee id as agent id. */
  EngageAgent agentById(String employeeId) {
    if (employeeId == null) return null;
    return byEmployee.computeIfAbsent(employeeId, id -> {
      try {
        CfgPersonQuery query = new CfgPersonQuery(service);
        query.setEmployeeId(id);
        CfgPerson person = query.executeSingleResult();
        return person == null ? null : new EngageAgent(person.getEmployeeID(), person.getUserName(), null, null, null);
      } catch (Exception e) {
        return null;
      }
    });
  }

  private EngageAgent lookupLogin(String login) {
    try {
      CfgAgentLoginQuery loginQuery = new CfgAgentLoginQuery(service);
      loginQuery.setLoginCode(login);
      CfgAgentLogin agentLogin = loginQuery.executeSingleResult();
      if (agentLogin == null) return null;
      CfgPersonQuery personQuery = new CfgPersonQuery(service);
      personQuery.setLoginDbid(agentLogin.getDBID());
      CfgPerson person = personQuery.executeSingleResult();
      return person == null ? null : new EngageAgent(person.getEmployeeID(), person.getUserName(), login, null, null);
    } catch (Exception e) {
      return null;
    }
  }

  @Override
  public void close() {
    try {
      if (protocol != null) protocol.close();
    } catch (Exception ignored) {
      // shutting down
    }
  }
}

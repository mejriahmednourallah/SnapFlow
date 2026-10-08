/** Reuse an existing project read and overlap the independent membership read. */
export async function loadProjectAccountData<Project, Members>(
  loadProject: () => Promise<Project>,
  loadMembers: () => Promise<Members>,
  existingProject?: Promise<Project>,
): Promise<[Project, Members]> {
  return Promise.all([existingProject ?? loadProject(), loadMembers()]);
}
